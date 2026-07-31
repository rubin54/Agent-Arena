"""Disposable containers used as a sandbox for agent runs.

Deliberately driven through the Docker CLI rather than the Python SDK: the CLI
talks to the Windows named pipe without trouble and can be awaited natively.

The isolation boundary is the container, not the filesystem inside it. It has no
mount onto the host, no network by default, fixed CPU/RAM/PID limits, no Linux
capabilities, and runs as an unprivileged user. The root filesystem stays
writable -- `read_only` would break `pip install` and `npm install` without
gaining anything, since the container is discarded after the run.
"""

import asyncio
import logging
import posixpath
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

from ..config import get_settings

log = logging.getLogger("arena.sandbox")

WORKSPACE = "/workspace"
LABEL = "arena-sandbox=1"

# Tool output is capped before it goes back into the model's context.
MAX_OUTPUT_CHARS = 20_000


class SandboxError(Exception):
    pass


@dataclass
class ExecResult:
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.timed_out


@dataclass
class SandboxConfig:
    network: bool = False
    memory_mb: int = 1024
    cpus: float = 2.0
    command_timeout_s: float = 60.0


def _docker_binary() -> str:
    binary = shutil.which(get_settings().docker_binary)
    if not binary:
        raise SandboxError(
            "Docker was not found. Agent runs require a running Docker Desktop."
        )
    return binary


async def _run(
    args: list[str], *, stdin: bytes | None = None, timeout: float | None = None
) -> tuple[int, bytes, bytes]:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(stdin), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise
    return proc.returncode or 0, stdout, stderr


def _decode(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace")
    if len(text) > MAX_OUTPUT_CHARS:
        return text[:MAX_OUTPUT_CHARS] + f"\n... [truncated, {len(text)} characters total]"
    return text


def resolve_path(path: str) -> str:
    """Resolve a path against the workspace and reject escapes.

    The container isolates anyway, but an agent that accidentally writes to
    `/etc` makes its own result unreproducible.
    """
    candidate = path if path.startswith("/") else posixpath.join(WORKSPACE, path)
    normalized = posixpath.normpath(candidate)
    if normalized != WORKSPACE and not normalized.startswith(WORKSPACE + "/"):
        raise SandboxError(f"Path lies outside {WORKSPACE}: {path}")
    return normalized


class DockerSandbox:
    def __init__(self, config: SandboxConfig | None = None) -> None:
        self.config = config or SandboxConfig()
        self.name = f"arena-sbx-{uuid.uuid4().hex[:12]}"
        self._started = False

    async def start(self) -> None:
        settings = get_settings()
        await ensure_image()

        args = [
            _docker_binary(),
            "run",
            "--detach",
            "--rm",
            "--name",
            self.name,
            "--label",
            LABEL,
            "--network",
            "bridge" if self.config.network else "none",
            "--memory",
            f"{self.config.memory_mb}m",
            "--cpus",
            str(self.config.cpus),
            "--pids-limit",
            "512",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--workdir",
            WORKSPACE,
            settings.sandbox_image,
            "sleep",
            "infinity",
        ]
        code, _, stderr = await _run(args, timeout=settings.sandbox_startup_timeout_s)
        if code != 0:
            raise SandboxError(f"Could not start container: {_decode(stderr).strip()}")
        self._started = True
        log.info("Sandbox %s started (network=%s)", self.name, self.config.network)

    async def stop(self) -> None:
        if not self._started:
            return
        self._started = False
        try:
            # --rm on the container cleans up on its own once it stops.
            await _run([_docker_binary(), "stop", "--time", "2", self.name], timeout=30)
        except Exception as exc:  # pragma: no cover -- cleanup must never fail the run
            log.warning("Could not stop sandbox %s: %s", self.name, exc)

    async def __aenter__(self) -> "DockerSandbox":
        await self.start()
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.stop()

    # ----------------------------------------------------------------- Tools

    async def exec(self, command: str, timeout: float | None = None) -> ExecResult:
        limit = timeout or self.config.command_timeout_s
        args = [
            _docker_binary(),
            "exec",
            self.name,
            # `timeout` inside the container kills runaway loops more reliably
            # than aborting the docker-exec process from the outside would.
            # TERM first (exit 124), KILL five seconds later (exit 137).
            "timeout",
            "--kill-after=5",
            str(int(limit)),
            "sh",
            "-c",
            command,
        ]
        try:
            code, stdout, stderr = await _run(args, timeout=limit + 20)
        except asyncio.TimeoutError:
            return ExecResult(124, "", f"Command aborted after {limit:.0f}s.", True)

        timed_out = code in (124, 137)
        if timed_out:
            note = (
                f"Command aborted after {limit:.0f}s."
                if code == 124
                # 137 = SIGKILL: either the kill backstop or the memory limit.
                else f"Process killed (time limit {limit:.0f}s or memory limit reached)."
            )
        return ExecResult(
            exit_code=code,
            stdout=_decode(stdout),
            stderr=note if timed_out else _decode(stderr),
            timed_out=timed_out,
        )

    async def write_file(self, path: str, content: str) -> str:
        target = resolve_path(path)
        # Content goes through stdin, which sidesteps shell escaping entirely.
        args = [
            _docker_binary(),
            "exec",
            "-i",
            self.name,
            "sh",
            "-c",
            'mkdir -p "$(dirname "$0")" && cat > "$0"',
            target,
        ]
        code, _, stderr = await _run(args, stdin=content.encode("utf-8"), timeout=60)
        if code != 0:
            raise SandboxError(_decode(stderr).strip() or f"Writing to {target} failed")
        return target

    async def read_file(self, path: str) -> str:
        target = resolve_path(path)
        code, stdout, stderr = await _run(
            [_docker_binary(), "exec", self.name, "cat", "--", target], timeout=60
        )
        if code != 0:
            raise SandboxError(_decode(stderr).strip() or f"{target} is not readable")
        return _decode(stdout)

    async def list_files(self, path: str = ".", depth: int = 3) -> str:
        target = resolve_path(path)
        command = (
            f'find "{target}" -maxdepth {depth} '
            r'\( -name node_modules -o -name .git -o -name __pycache__ -o -name .venv \) -prune '
            r"-o -print"
        )
        result = await self.exec(command, timeout=30)
        if not result.ok:
            raise SandboxError(result.stderr.strip() or f"{target} cannot be listed")
        listing = result.stdout.strip()
        return listing or "(empty)"

    async def seed_files(self, files: list[dict]) -> list[str]:
        """Place starter files in the workspace before the agent begins."""
        written: list[str] = []
        for entry in files or []:
            path = (entry or {}).get("path")
            if not path:
                continue
            written.append(await self.write_file(path, (entry or {}).get("content", "")))
        return written

    async def collect_workspace(self, max_files: int = 40, max_chars: int = 4000) -> list[dict]:
        """Collect the final workspace state for display in the UI."""
        try:
            listing = await self.list_files(".", depth=3)
        except SandboxError:
            return []

        results: list[dict] = []
        for line in listing.splitlines():
            path = line.strip()
            if not path or path == WORKSPACE:
                continue
            if len(results) >= max_files:
                break
            check = await self.exec(f'test -f "{path}" && echo file || echo dir', timeout=15)
            if check.stdout.strip() != "file":
                continue
            try:
                content = await self.read_file(path)
            except SandboxError:
                continue
            truncated = len(content) > max_chars
            results.append(
                {
                    "path": posixpath.relpath(path, WORKSPACE),
                    "content": content[:max_chars],
                    "truncated": truncated,
                }
            )
        return results


# --------------------------------------------------------------------- Image


_image_lock = asyncio.Lock()


async def image_exists() -> bool:
    settings = get_settings()
    code, _, _ = await _run(
        [_docker_binary(), "image", "inspect", settings.sandbox_image], timeout=60
    )
    return code == 0


async def ensure_image() -> None:
    """Build the sandbox image if it is missing. Makes the first agent run slower."""
    settings = get_settings()
    async with _image_lock:
        if await image_exists():
            return

        context = Path(__file__).resolve().parents[2] / "sandbox"
        if not (context / "Dockerfile").exists():
            raise SandboxError(f"Dockerfile not found at {context}")

        log.info("Building sandbox image %s -- the first build takes a few minutes.",
                 settings.sandbox_image)
        code, _, stderr = await _run(
            [_docker_binary(), "build", "-t", settings.sandbox_image, str(context)],
            timeout=settings.sandbox_build_timeout_s,
        )
        if code != 0:
            raise SandboxError(f"Image build failed: {_decode(stderr).strip()[-1500:]}")
        log.info("Sandbox image %s built.", settings.sandbox_image)


async def cleanup_stale_containers() -> int:
    """Collect containers left behind by crashed runs, on backend startup."""
    try:
        code, stdout, _ = await _run(
            [_docker_binary(), "ps", "-aq", "--filter", f"label={LABEL}"], timeout=30
        )
    except (SandboxError, asyncio.TimeoutError, OSError):
        return 0
    if code != 0:
        return 0

    ids = [line for line in _decode(stdout).split() if line]
    if not ids:
        return 0
    await _run([_docker_binary(), "rm", "--force", *ids], timeout=60)
    log.info("Removed %d orphaned sandbox containers.", len(ids))
    return len(ids)
