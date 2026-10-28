"""Run a Gym El Farol BehaviorSpace experiment with NetLogo headless.

Finds a local NetLogo 6.3+/7 install and writes a table CSV plus a timing
log. Default is the 3x3 info-mode x memory-size pilot (5 seeds).

    python analysis/run_pilot.py --smoke
    python analysis/run_pilot.py --experiment info-memory-pilot
    python analysis/run_pilot.py --experiment info-memory-grid
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NETLOGO_DIR = ROOT / "netlogo"
MODEL_PATH = NETLOGO_DIR / "GymElFarol.nlogox"
SETUP_PATH = NETLOGO_DIR / "experiments.xml"
DEFAULT_OUT = ROOT / "data" / "processed" / "pilot.csv"
LOG_PATH = ROOT / "data" / "processed" / "pilot.log"
META_PATH = ROOT / "data" / "processed" / "pilot_run_meta.json"

NETLOGO_CANDIDATES = [
    Path(r"C:\Program Files\NetLogo 7.0.4"),
    Path(r"C:\Program Files\NetLogo 7.0.3"),
    Path(r"C:\Program Files\NetLogo 7.0.2"),
    Path(r"C:\Program Files\NetLogo 7.0.1"),
    Path(r"C:\Program Files\NetLogo 7.0.0"),
    Path(r"C:\Program Files\NetLogo 6.4.0"),
    Path(r"C:\Program Files\NetLogo 6.3.0"),
    Path(r"C:\Program Files (x86)\NetLogo 6.3.0"),
]


def _netlogo_homes() -> list[Path]:
    homes: list[Path] = []
    env = os.environ.get("NETLOGO_HOME")
    if env:
        homes.append(Path(env))
    program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    homes.extend(sorted(program_files.glob("NetLogo *"), reverse=True))
    homes.extend(NETLOGO_CANDIDATES)
    seen: set[Path] = set()
    unique: list[Path] = []
    for home in homes:
        resolved = home.resolve() if home.exists() else home
        if resolved in seen:
            continue
        seen.add(resolved)
        unique.append(home)
    return unique


def find_netlogo_home(explicit: Path | None = None) -> Path:
    if explicit is not None:
        if explicit.is_file():
            return explicit.parent
        if explicit.exists():
            return explicit
        raise FileNotFoundError(f"NetLogo home not found: {explicit}")
    for home in _netlogo_homes():
        if (home / "app").exists() or (home / "NetLogo_Console.exe").exists():
            return home
    raise FileNotFoundError(
        "Could not find a NetLogo install. Install NetLogo 7 or set NETLOGO_HOME."
    )


def find_bundled_java(home: Path) -> Path:
    bundled = home / "runtime" / "bin" / "java.exe"
    if bundled.exists():
        return bundled
    env_home = os.environ.get("JAVA_HOME")
    if env_home:
        java = Path(env_home) / "bin" / "java.exe"
        if java.exists():
            return java
    raise FileNotFoundError(
        f"No bundled Java in {home}\\runtime and JAVA_HOME is not set."
    )


def find_netlogo_jar(home: Path) -> Path:
    app = home / "app"
    jars = sorted(app.glob("netlogo-*.jar"), reverse=True)
    if jars:
        return jars[0]
    raise FileNotFoundError(f"No netlogo-*.jar in {app}")


def setup_logging() -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(LOG_PATH, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


def default_threads() -> int:
    cpu = os.cpu_count() or 2
    return max(1, int(0.75 * cpu))


def staging_root() -> Path:
    """NetLogo 7 headless drops arguments after the first space in a path."""
    for candidate in (Path(r"C:\Temp"), Path(os.environ.get("TEMP", r"C:\Temp"))):
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            if " " not in str(candidate.resolve()):
                return candidate
        except OSError:
            continue
    return Path(tempfile.gettempdir())


def stage_model(work_dir: Path) -> Path:
    work_dir.mkdir(parents=True, exist_ok=True)
    staged_model = work_dir / MODEL_PATH.name
    shutil.copy2(MODEL_PATH, staged_model)
    shutil.copy2(SETUP_PATH, work_dir / SETUP_PATH.name)
    seed = NETLOGO_DIR / "seed_history.csv"
    if seed.exists():
        shutil.copy2(seed, work_dir / "seed_history.csv")
    return staged_model


def build_command(
    home: Path,
    experiment: str,
    table_path: Path,
    threads: int,
    model_path: Path,
) -> list[str]:
    java = find_bundled_java(home)
    jar = find_netlogo_jar(home)
    return [
        str(java),
        "-XX:MaxRAMPercentage=50",
        "-Dfile.encoding=UTF-8",
        f"-Dnetlogo.docs.dir={home}",
        f"-Dnetlogo.models.dir={home / 'models'}",
        f"-Dnetlogo.extensions.dir={home / 'extensions'}",
        "--add-exports=java.base/java.lang=ALL-UNNAMED",
        "--add-exports=java.desktop/sun.awt=ALL-UNNAMED",
        "--add-exports=java.desktop/sun.java2d=ALL-UNNAMED",
        "-classpath",
        str(jar),
        "org.nlogo.headless.Main",
        "--model",
        str(model_path),
        "--experiment",
        experiment,
        "--table",
        str(table_path),
        "--threads",
        str(threads),
    ]


def run_experiment(
    experiment: str,
    table_path: Path,
    threads: int,
    home: Path,
) -> dict:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Missing model: {MODEL_PATH}")
    if not SETUP_PATH.exists():
        raise FileNotFoundError(f"Missing experiments.xml: {SETUP_PATH}")

    table_path.parent.mkdir(parents=True, exist_ok=True)
    if table_path.exists():
        table_path.unlink()

    work_dir = staging_root() / "gym-elfarol-bs"
    staged_model = stage_model(work_dir)
    staged_table = work_dir / table_path.name
    if staged_table.exists():
        staged_table.unlink()

    command = build_command(home, experiment, staged_table, threads, staged_model)
    logging.info("NetLogo home: %s", home)
    logging.info("Staged model dir: %s", work_dir)
    logging.info("Experiment: %s  threads=%s", experiment, threads)
    logging.info("Command: %s", " ".join(command))

    started = time.perf_counter()
    started_iso = datetime.now(timezone.utc).isoformat()
    # cwd is the staged model directory so seed_history.csv resolves.
    completed = subprocess.run(
        command,
        cwd=str(work_dir),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    elapsed = time.perf_counter() - started
    if completed.stdout:
        logging.info("NetLogo stdout:\n%s", completed.stdout.strip())
    if completed.stderr:
        logging.info("NetLogo stderr:\n%s", completed.stderr.strip())
    if completed.returncode != 0:
        raise RuntimeError(
            f"NetLogo exited {completed.returncode} after {elapsed:.1f}s"
        )
    if not staged_table.exists() or staged_table.stat().st_size == 0:
        raise RuntimeError(f"BehaviorSpace wrote no table: {staged_table}")
    shutil.copy2(staged_table, table_path)
    if not table_path.exists() or table_path.stat().st_size == 0:
        raise RuntimeError(f"Failed to copy table to {table_path}")

    meta = {
        "experiment": experiment,
        "model": str(MODEL_PATH),
        "setup_file": str(SETUP_PATH),
        "table": str(table_path),
        "netlogo": str(home),
        "threads": threads,
        "started_utc": started_iso,
        "elapsed_seconds": round(elapsed, 3),
        "returncode": completed.returncode,
        "table_bytes": table_path.stat().st_size,
    }
    META_PATH.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    logging.info(
        "Finished %s in %.1f s -> %s (%s bytes)",
        experiment,
        elapsed,
        table_path,
        meta["table_bytes"],
    )
    return meta


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--experiment",
        default="info-memory-pilot",
        help="BehaviorSpace experiment name (default: info-memory-pilot)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUT,
        help="Table CSV path",
    )
    parser.add_argument("--threads", type=int, default=0, help="0 = 75%% of CPUs")
    parser.add_argument(
        "--netlogo",
        type=Path,
        default=None,
        help="NetLogo home or NetLogo_Console.exe",
    )
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Run smoke-one-day (24 ticks, 1 seed) instead of the named experiment",
    )
    return parser


def main() -> int:
    setup_logging()
    args = build_parser().parse_args()
    experiment = "smoke-one-day" if args.smoke else args.experiment
    output = (
        ROOT / "data" / "processed" / "smoke.csv" if args.smoke else args.output
    )
    threads = args.threads if args.threads > 0 else default_threads()
    home = find_netlogo_home(args.netlogo)
    run_experiment(experiment, output, threads, home)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
