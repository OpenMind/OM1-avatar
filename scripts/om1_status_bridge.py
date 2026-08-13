import argparse
import asyncio
import glob
import json
import os
import re
import time

import websockets

PUBLISH_PERIOD = 1.0          # avatar marks subsystems unknown after 3s
CAMERA_PROBE_PERIOD = 60.0    # real capture probes are expensive; do them rarely
PROBE_FRAMES = 30

# Two lidar fits exist across the fleet: a Livox MID360 on the robot body,
# reached over the wired robot link and converted to /scan inside a ros2
# container, and an RPLIDAR S2 on a CP210x USB-UART bridge wired straight to
# the brainpack. Neither is assumed here — LidarTracker checks both fits every
# tick and reports whichever this robot actually carries.
ROBOT_LINK_IFACE = "enP2p1s0"
SENSOR_CONTAINERS = ["om1_sensor_dev", "orchestrator"]  # first with a /scan rate wins
LIDAR_PROBE_PERIOD = 30.0     # ros2 topic hz costs ~10 s, so probe sparsely
# The S2 ships behind a Silicon Labs CP210x; the by-id symlink names the
# vendor, so presence is a glob — no udevadm subprocess needed.
RPLIDAR_BY_ID_GLOB = "/dev/serial/by-id/*Silicon_Labs_CP210*"

# Two cameras: the RealSense D435i colour node and the Arducam RGB module.
# Reported as separate subsystems so each gets its own tile.
# by-id symlinks survive USB re-enumeration — the Arducam has already dropped
# off the bus once and come back on different /dev/videoN numbers.
CAMERAS = [
    {
        "subsystem": "camera",
        "name": "d435i",
        "device": "/dev/v4l/by-id/usb-Intel_R__RealSense_TM__Depth_Camera_435i_Intel_R__RealSense_TM__Depth_Camera_435i_251643060785-video-index0",
        "input_format": None,
    },
    {
        "subsystem": "arducam",
        "name": "arducam",
        "device": "/dev/v4l/by-id/usb-Arducam_Technology_Co.__Ltd._Arducam_1080P_Low_Light_UC684-video-index0",
        "input_format": "mjpeg",
    },
]

# The robot's speaker/mic is the C-Media USB adapter. USB enumeration order
# (and therefore ALSA card numbers) reshuffles across reboots, so the card is
# resolved by name at every check instead of pinned to an index.
AUDIO_CARD_MATCH = "c-media"


async def run(*cmd, timeout=10):
    """Run a command, returning (rc, stdout). Never raises on failure."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
        )
    except FileNotFoundError:
        return 127, ""
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return 124, ""
    return proc.returncode, stdout.decode(errors="replace")


def read_text(path):
    try:
        with open(path) as handle:
            return handle.read().strip()
    except OSError:
        return None


# ---------------------------------------------------------------- wifi

def wifi_status():
    raw = read_text("/proc/net/wireless")
    if not raw:
        return {"state": "unknown", "detail": "no wireless extensions"}

    for line in raw.splitlines():
        if ":" not in line or line.strip().startswith(("Inter", "face")):
            continue
        iface, _, rest = line.partition(":")
        fields = rest.split()
        if len(fields) < 3:
            continue
        try:
            # columns: status, link quality, signal level, noise
            quality = float(fields[1].rstrip("."))
            rssi = float(fields[2].rstrip("."))
        except ValueError:
            continue

        # Link quality is reported out of 70 by the mac80211 stack.
        normalized = max(0.0, min(1.0, quality / 70.0))
        if rssi >= -67:
            state = "ok"
        elif rssi >= -80:
            state = "warn"
        else:
            state = "down"
        return {
            "state": state,
            "detail": f"{iface.strip()} {rssi:.0f} dBm",
            "rssi_dbm": rssi,
            "quality": round(normalized, 2),
        }

    return {"state": "down", "detail": "no wireless link"}


# ---------------------------------------------------------------- held devices

class HeldScanner:
    """One /proc/*/fd sweep per publish tick, shared by all device checks.

    The holders are root processes inside containers (realsense node, gst,
    rplidar), invisible to plain fuser — the fd table never lies.
    """

    def __init__(self):
        self.paths = set()

    async def refresh(self):
        rc, out = await run(
            "sudo", "-n", "sh", "-c", r"ls -l /proc/[0-9]*/fd 2>/dev/null", timeout=10
        )
        if rc in (0, 1):
            self.paths = set(re.findall(r"/dev/(?:video\d+|ttyUSB\d+)", out))

    def held(self, device):
        return device in self.paths


# ---------------------------------------------------------------- lidar

class LidarTracker:
    """Health of whichever lidar this robot carries.

    Livox MID360 (ethernet): instant signal is carrier on the robot link (no
    carrier = the brainpack↔robot cable is unplugged, nothing can arrive);
    slow signal is the actual /scan publish rate measured inside a ros2
    container, probed in the background so the publish loop never stalls.

    RPLIDAR S2 (serial): the CP210x bridge identifies itself in
    /dev/serial/by-id, and a driver holding the port open means scans flow.
    The port is never opened here — spinning up the motor behind the real
    driver's back is not a safe thing for a status probe to do.
    """

    def __init__(self):
        self.hz = None
        self.probed_once = False
        self.probing = False
        self.last_probe = 0.0

    async def probe(self):
        try:
            self.hz = None
            for container in SENSOR_CONTAINERS:
                rc, out = await run(
                    "docker", "exec", container, "bash", "-c",
                    "source /opt/ros/*/setup.bash 2>/dev/null; "
                    "timeout 12 ros2 topic hz /scan --window 15 2>&1 | grep -m1 'average rate'",
                    timeout=25,
                )
                match = re.search(r"average rate:\s*([\d.]+)", out)
                if match:
                    self.hz = float(match.group(1))
                    break
            self.probed_once = True
        finally:
            self.probing = False

    def mid360_status(self):
        carrier = read_text(f"/sys/class/net/{ROBOT_LINK_IFACE}/carrier")
        if carrier != "1":
            return {
                "state": "down",
                "detail": f"robot link {ROBOT_LINK_IFACE} no carrier — check brainpack↔robot cable",
            }

        now = time.monotonic()
        if not self.probing and now - self.last_probe >= LIDAR_PROBE_PERIOD:
            self.probing = True
            self.last_probe = now
            asyncio.get_running_loop().create_task(self.probe())

        if self.hz:
            return {"state": "ok", "detail": "livox mid360 → /scan", "hz": round(self.hz, 1)}
        if not self.probed_once:
            return {"state": "unknown", "detail": "measuring /scan rate…"}
        return {"state": "down", "detail": "robot link up, but no /scan data (livox not publishing)"}

    def rplidar_status(self, scanner):
        links = glob.glob(RPLIDAR_BY_ID_GLOB)
        if not links:
            return {"state": "down", "detail": "no CP210x USB-UART bridge (rplidar unplugged)"}
        port = os.path.realpath(links[0])
        if scanner.held(port):
            return {"state": "ok", "detail": f"rplidar s2 {port} streaming (driver attached)"}
        return {"state": "warn", "detail": f"rplidar s2 {port} present, no driver attached"}

    def status(self, scanner):
        rplidar = self.rplidar_status(scanner)
        if rplidar["state"] == "ok":
            # A driver is actively pulling scans off the serial port — that is
            # the lidar in use, whatever else may be fitted.
            return rplidar

        mid360 = self.mid360_status()
        if mid360["state"] == "down" and rplidar["state"] == "down":
            return {
                "state": "down",
                "detail": f"no lidar — {mid360['detail']}; {rplidar['detail']}",
            }
        if mid360["state"] != "down":
            # Robot link is cabled: the MID360 verdict stands. A vestigial
            # undriven RPLIDAR (G1 fit) must not mask a dead /scan pipeline.
            return mid360
        return rplidar


# ---------------------------------------------------------------- audio

def resolve_alsa_card():
    """Card index of the robot's speaker/mic adapter, matched by name."""
    raw = read_text("/proc/asound/cards")
    if raw is not None:
        current = None
        for line in raw.splitlines():
            match = re.match(r"\s*(\d+)\s+\[", line)
            if match:
                current = int(match.group(1))
            if current is not None and AUDIO_CARD_MATCH in line.lower():
                return current
    # Fallback: first card that exposes a playback PCM at all.
    for index in range(8):
        if read_text(f"/proc/asound/card{index}/pcm0p/sub0/status") is not None:
            return index
    return None


def pcm_state(direction):
    """direction: 'c' for capture, 'p' for playback."""
    card = resolve_alsa_card()
    if card is None:
        return None
    raw = read_text(f"/proc/asound/card{card}/pcm0{direction}/sub0/status")
    if raw is None:
        return None
    return "running" if raw.splitlines()[0].strip().lower().startswith("state: running") else "idle"


def mic_status():
    state = pcm_state("c")
    if state is None:
        return {"state": "down", "detail": "robot audio card absent (no capture pcm)"}
    if state == "running":
        # Held by the ASR pipeline. We deliberately do not open the device to
        # sample a level — that would steal it from whatever is capturing.
        return {"state": "ok", "detail": "capturing (pipeline attached)"}
    return {"state": "warn", "detail": "device present, no consumer"}


class SpeakerTracker:
    def __init__(self):
        self.last_playback = None

    def status(self):
        state = pcm_state("p")
        if state is None:
            return {"state": "down", "detail": "robot audio card absent (no playback pcm)"}

        now = time.monotonic()
        if state == "running":
            self.last_playback = now
            return {"state": "ok", "detail": "playing", "last_playback_age_s": 0.0}

        if self.last_playback is None:
            return {"state": "ok", "detail": "idle (no playback observed yet)"}

        age = now - self.last_playback
        return {"state": "ok", "detail": "idle", "last_playback_age_s": round(age, 1)}


# ---------------------------------------------------------------- cameras

async def negotiated_fps(device):
    rc, out = await run("v4l2-ctl", "-d", device, "--get-parm", timeout=5)
    if rc != 0:
        return None
    match = re.search(r"Frames per second:\s*([\d.]+)", out)
    return float(match.group(1)) if match else None


async def probe_capture(camera):
    """Capture real frames to prove the sensor produces data. Returns fps or None."""
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "v4l2"]
    if camera["input_format"]:
        cmd += ["-input_format", camera["input_format"]]
    cmd += ["-i", camera["device"], "-frames:v", str(PROBE_FRAMES), "-f", "null", "-"]

    start = time.monotonic()
    rc, _ = await run(*cmd, timeout=25)
    elapsed = time.monotonic() - start
    if rc != 0 or elapsed <= 0:
        return None
    return PROBE_FRAMES / elapsed


class CameraTracker:
    def __init__(self):
        self.probes = {}       # key -> measured fps
        self.last_probe = 0.0

    async def refresh_probes(self, cameras_free):
        now = time.monotonic()
        if now - self.last_probe < CAMERA_PROBE_PERIOD:
            return
        self.last_probe = now
        for camera in cameras_free:
            self.probes[camera["name"]] = await probe_capture(camera)

    async def status(self, scanner):
        """Return one subsystem entry per camera, keyed by subsystem name."""
        result = {}
        free = []

        for camera in CAMERAS:
            name = camera["name"]

            # os.path.exists follows the by-id symlink; a dangling link (device
            # unplugged) correctly reads as absent. realpath gives the real
            # /dev/videoN node the fd-table scan reports.
            if not os.path.exists(camera["device"]):
                result[camera["subsystem"]] = {
                    "state": "down",
                    "detail": f"{name} unplugged (no by-id node)",
                }
                continue
            device = os.path.realpath(camera["device"])

            held = scanner.held(device)
            negotiated = await negotiated_fps(device)

            if held:
                # A consumer is streaming — the healthy steady state.
                entry = {"state": "ok", "detail": f"{name} streaming (consumer attached)"}
                if negotiated:
                    entry["fps"] = negotiated
            else:
                free.append(camera)
                measured = self.probes.get(name)
                if measured is None:
                    entry = {"state": "warn", "detail": f"{name} idle, no consumer"}
                elif measured > 0:
                    # Real number from our own capture probe, but nothing is
                    # consuming the stream.
                    entry = {
                        "state": "warn",
                        "detail": f"{name} idle, no consumer",
                        "fps": round(measured, 1),
                    }
                else:
                    entry = {"state": "down", "detail": f"{name} present but no frames"}

            result[camera["subsystem"]] = entry

        await self.refresh_probes(free)
        return result


# ---------------------------------------------------------------- activity

OM1_CONTAINER = "om1"
ACTIVITY_PUBLISH_PERIOD = 0.5   # avatar clears lamps after 5 s without a frame
LISTENING_HOLD = 2.5            # how long one ASR partial keeps the lamp lit
THINKING_MAX = 20.0             # give up if the cortex never answers
LLM_DONE_GRACE = 3.0            # thinking lingers briefly after the LLM returns
SPEAKING_MAX = 120.0            # safety valve if an ffplay end line is missed


class ActivityMonitor:
    """Tracks listening/thinking/speaking from om1's log lines.

    Every transition is driven by a real pipeline event; nothing is guessed.
    `available` is False while the log follower is down, which suppresses
    activity_state frames entirely rather than reporting a fake idle.
    """

    def __init__(self):
        self.available = False
        self.listening_until = 0.0
        self.listening_detail = ""
        self.thinking_until = 0.0
        self.speaking_since = None
        # Latest sentence the cortex decided to say, from the tracer file.
        # Shown as the subtitle while the speaking lamp is lit.
        self.response_text = ""
        self.response_at = None
        # Chain-of-thought feed for the on-screen COT window: a short ring of
        # pipeline events plus the latest vision description, all real.
        self.events = []           # list of {"t", "kind", "text"}, newest last
        self.vision = ""
        self.vision_at = None
        # Learned TTS speaking rate (chars/sec), refined from each completed
        # utterance's real playback duration so subtitle pacing tracks the
        # actual voice speed. 13 is a reasonable prior for the current voice.
        self.tts_cps = 13.0
        self.speak_text_len = 0
        # Real mode state, tracked from om1's own mode-transition log lines.
        self.current_mode = ""
        self.seen_modes = set()

    def add_event(self, kind, text):
        if not text:
            return
        self.events.append({"t": time.time(), "kind": kind, "text": text[:300]})
        del self.events[:-12]

    def feed_line(self, line):
        try:
            record = json.loads(line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return
        if isinstance(record, dict):
            self.handle_record(record)

    def handle_record(self, record):
        msg = record.get("msg") or ""
        logger = record.get("logger") or ""
        caller = record.get("caller") or ""
        now = time.monotonic()

        # ASR transcripts streaming in: someone is talking to the robot.
        # Only frames carrying actual transcript text count — the ASR also
        # emits empty partial/committed frames (VAD tripping on background
        # noise, keepalives), and lighting the lamp on those showed a phantom
        # "listening" with the previous utterance as its subtitle.
        if msg == "ws: message received" and "ASR" in logger:
            data = record.get("data") or ""
            if '"partial"' in data or '"committed"' in data:
                try:
                    text = json.loads(data).get("asr_reply") or ""
                except (json.JSONDecodeError, AttributeError):
                    text = ""
                if text:
                    self.listening_until = now + LISTENING_HOLD
                    self.listening_detail = f"“…{text[-38:]}”" if len(text) > 38 else f"“{text}”"
            return

        # An utterance was handed to the cortex, or the cortex ticked on its
        # own (VLM-driven ticks are genuine thinking too).
        if msg == "transcript accepted":
            self.thinking_until = max(self.thinking_until, now + THINKING_MAX)
            self.add_event("heard", record.get("text") or "")
            return
        if msg == "cortex tick":
            self.thinking_until = max(self.thinking_until, now + THINKING_MAX)
            mode = str(record.get("mode") or "")
            if mode:
                self.current_mode = mode
                self.seen_modes.add(mode)
            self.add_event("think", f"cortex tick ({mode})" if mode else "cortex tick")
            return

        # om1 logs `mode initialised` with the short mode key on every switch.
        if msg == "mode initialised":
            mode = str(record.get("mode") or "")
            if mode:
                self.current_mode = mode
                self.seen_modes.add(mode)
            return

        # Vision descriptions are pinned in the COT window, not event lines —
        # they arrive every second and would drown everything else out.
        if msg == "Vision client response":
            content = record.get("content") or ""
            if content:
                self.vision = content[:200]
                self.vision_at = time.time()
            return

        # Mode and greeting-flow transitions explain silences and cutoffs.
        if msg == "initializing mode":
            self.add_event("mode", str(record.get("mode") or ""))
            return
        if msg.startswith("greeting: transitioning to"):
            self.add_event("flow", msg.removeprefix("greeting: "))
            return

        # The cortex LLM answered (metrics line, e.g. msg="GeminiLLM").
        # VLM calls log as "VLMGeminiRTSP" and don't end thinking.
        if caller.startswith("metrics/") and msg.endswith("LLM"):
            if now < self.thinking_until:
                self.thinking_until = min(self.thinking_until, now + LLM_DONE_GRACE)
            return

        # TTS playback boundaries (both elevenlabs and kokoro players).
        if msg.endswith("ffplay started"):
            self.speaking_since = now
            self.thinking_until = 0.0
            fresh = self.response_at is not None and now - self.response_at < 120
            self.speak_text_len = len(self.response_text) if fresh else 0
            return
        if msg.endswith("TTS interrupted by user speech"):
            self.speaking_since = None
            self.add_event("speak", "tts interrupted by user speech")
            return
        if msg.endswith("ffplay finished") or msg.endswith("ffplay timeout, killing"):
            # A completed utterance is a real measurement of the voice's rate.
            if (
                msg.endswith("ffplay finished")
                and self.speaking_since is not None
                and self.speak_text_len >= 30
            ):
                duration = now - self.speaking_since
                if 1.0 < duration < 120.0:
                    rate = self.speak_text_len / duration
                    if 6.0 <= rate <= 25.0:
                        self.tts_cps = round(0.65 * self.tts_cps + 0.35 * rate, 2)
            self.speaking_since = None
            self.speak_text_len = 0

    def snapshot(self):
        """Return one activity_state frame, or None while the follower is down."""
        if not self.available:
            return None

        now = time.monotonic()
        if self.speaking_since is not None and now - self.speaking_since > SPEAKING_MAX:
            self.speaking_since = None

        if self.speaking_since is not None:
            state = "speaking"
            fresh = self.response_at is not None and now - self.response_at < 120
            detail = self.response_text if fresh else ""
        elif now < self.thinking_until:
            state, detail = "thinking", ""
        elif now < self.listening_until:
            state, detail = "listening", self.listening_detail
        else:
            state, detail = "idle", ""

        frame = {
            "type": "activity_state",
            "ts": time.time(),
            "state": state,
            "tts_cps": self.tts_cps,
        }
        if detail:
            frame["detail"] = detail
        return frame

    def feed_tracer_line(self, line):
        """Capture the cortex's spoken sentence from a tracer jsonl record."""
        try:
            record = json.loads(line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return
        if not isinstance(record, dict):
            return
        outputs = record.get("llm_output")
        if not isinstance(outputs, list):
            return
        actions = []
        for entry in outputs:
            value = entry.get("value") if isinstance(entry, dict) else None
            if not isinstance(value, dict):
                continue
            # Spoken text lives under different keys per flow:
            #   greeting flow:      {"type": "greeting_conversation", "value": {"response": ...}}
            #   conversation flow:  {"type": "speak", "value": {"action": "<sentence>"}}
            text = value.get("response") or value.get("sentence")
            if not text and entry.get("type") == "speak":
                text = value.get("action")
            if isinstance(text, str) and text.strip():
                # Full sentence, not a preview — the UI paces through all of it.
                self.response_text = text.strip()[:1200]
                self.response_at = time.monotonic()
                self.add_event("reply", self.response_text)
            elif isinstance(value.get("action"), str):
                actions.append(f"{entry.get('type', 'action')}={value['action']}")
        if actions:
            self.add_event("action", ", ".join(actions))


async def follow_om1_logs(monitor):
    """Follow the om1 container's log stream forever, feeding the monitor.

    Reads raw chunks rather than readline(): cortex tick lines carry the full
    prompt (tens of KB) and would overrun StreamReader's default line limit.
    """
    while True:
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker", "logs", "-f", "--tail", "0", OM1_CONTAINER,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except FileNotFoundError:
            print("activity: docker not found, no activity signal", flush=True)
            return

        print(f"activity: following {OM1_CONTAINER} logs", flush=True)
        monitor.available = True
        buffer = b""
        try:
            while True:
                chunk = await proc.stdout.read(65536)
                if not chunk:
                    break
                buffer += chunk
                *lines, buffer = buffer.split(b"\n")
                for line in lines:
                    monitor.feed_line(line)
                if len(buffer) > 8 * 1024 * 1024:
                    buffer = b""  # pathological unterminated line; drop it
        finally:
            monitor.available = False
            if proc.returncode is None:
                proc.kill()

        print("activity: om1 log stream ended, retrying in 2s", flush=True)
        await asyncio.sleep(2)


async def follow_om1_tracer(monitor):
    """Follow the om1 tracer file for LLM outputs (the sentences it speaks).

    The tracer rolls to a new date-stamped file at UTC midnight, so the tail
    is restarted whenever the date changes (checked via a read timeout).
    """
    while True:
        day = time.strftime("%Y-%m-%d", time.gmtime())
        path = f"/app/OM1/traces/tracer_{day}.jsonl"
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker", "exec", OM1_CONTAINER, "tail", "-F", "-n", "0", path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
        except FileNotFoundError:
            return

        buffer = b""
        try:
            while True:
                if time.strftime("%Y-%m-%d", time.gmtime()) != day:
                    break  # date rolled over; re-tail the new file
                try:
                    chunk = await asyncio.wait_for(proc.stdout.read(65536), timeout=30)
                except asyncio.TimeoutError:
                    continue
                if not chunk:
                    break
                buffer += chunk
                *lines, buffer = buffer.split(b"\n")
                for line in lines:
                    monitor.feed_tracer_line(line)
                if len(buffer) > 8 * 1024 * 1024:
                    buffer = b""
        finally:
            if proc.returncode is None:
                proc.kill()

        await asyncio.sleep(5)


async def activity_loop(ws, monitor):
    while True:
        frame = monitor.snapshot()
        if frame is not None:
            await ws.send(json.dumps(frame))
            vision_fresh = (
                monitor.vision_at is not None and time.time() - monitor.vision_at < 15
            )
            await ws.send(
                json.dumps(
                    {
                        "type": "cot",
                        "ts": time.time(),
                        "vision": monitor.vision if vision_fresh else "",
                        "events": monitor.events,
                    }
                )
            )
        await asyncio.sleep(ACTIVITY_PUBLISH_PERIOD)


# ---------------------------------------------------------------- om1 state

# Real runtime facts about the om1 container, refreshed in the background:
# whether it is running (drives the avatar health check) and the mode list
# parsed from its active config file (drives the mode selector).
OM1_STATE = {"running": False, "config_modes": []}


async def fetch_config_modes():
    """Read the mode keys out of om1's active config file.

    The config name comes from the om1 process's own command line
    (`om1 -config <name>`) — the container Cmd can disagree with the
    OM1_COMMAND env var, but /proc/1/cmdline is the ground truth.
    """
    rc, out = await run("docker", "exec", OM1_CONTAINER, "cat", "/proc/1/cmdline", timeout=5)
    if rc != 0:
        return []
    args = [a for a in out.split("\0") if a]
    name = ""
    for i, arg in enumerate(args):
        if arg == "-config" and i + 1 < len(args):
            name = args[i + 1]
            break
    if not name:
        return []
    rc, cfg = await run(
        "docker", "exec", OM1_CONTAINER, "cat", f"/app/OM1/config/{name}.json5", timeout=5
    )
    if rc != 0 or not cfg:
        return []

    start = re.search(r"^\s*modes:\s*\{", cfg, re.M)
    if not start:
        return []
    # Walk to the modes block's matching close brace, then take its keys.
    depth, end = 1, len(cfg)
    for pos in range(start.end(), len(cfg)):
        if cfg[pos] == "{":
            depth += 1
        elif cfg[pos] == "}":
            depth -= 1
            if depth == 0:
                end = pos
                break
    block = cfg[start.end():end]
    return re.findall(r"^\s{4}([A-Za-z0-9_]+):\s*\{", block, re.M)


async def seed_current_mode(monitor):
    """One-shot backscan so the mode selector is right immediately after a
    bridge restart, instead of blank until om1's next mode line."""
    rc, out = await run(
        "sh", "-c", f"docker logs --tail 4000 {OM1_CONTAINER} 2>&1", timeout=20
    )
    if rc != 0:
        return
    for line in reversed(out.splitlines()):
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(record, dict):
            continue
        mode = str(record.get("mode") or "")
        if mode and record.get("msg") in ("mode initialised", "cortex tick"):
            monitor.seen_modes.add(mode)
            if not monitor.current_mode:
                monitor.current_mode = mode
            return


async def watch_om1_state():
    fetched = []
    while True:
        rc, out = await run("docker", "inspect", "-f", "{{.State.Running}}", OM1_CONTAINER, timeout=5)
        OM1_STATE["running"] = rc == 0 and out.strip() == "true"
        if OM1_STATE["running"] and not fetched:
            fetched = await fetch_config_modes()
            OM1_STATE["config_modes"] = fetched
        await asyncio.sleep(5)


# ---------------------------------------------------------------- server

async def publish_loop(ws, cameras, speaker, scanner, lidar):
    while True:
        await scanner.refresh()
        subsystems = {
            **await cameras.status(scanner),
            "lidar": lidar.status(scanner),
            "mic": mic_status(),
            "speaker": speaker.status(),
            "wifi": wifi_status(),
        }
        # `overall` is omitted so the client derives it from the worst subsystem.
        await ws.send(
            json.dumps({"type": "system_status", "ts": time.time(), "subsystems": subsystems})
        )
        await asyncio.sleep(PUBLISH_PERIOD)


async def answer_requests(ws, monitor):
    async for raw in ws:
        try:
            request = json.loads(raw)
        except json.JSONDecodeError:
            continue

        action = request.get("action")
        request_id = request.get("request_id")

        if action == "get_avatar_status":
            # Real health: om1 running and its log stream attached. No om1,
            # no avatar — the UI correctly shows its loading screen.
            active = OM1_STATE["running"] and monitor.available
            await ws.send(
                json.dumps(
                    {
                        "request_id": request_id,
                        "code": 0 if active else 1,
                        "status": "active" if active else "inactive",
                    }
                )
            )
        elif action == "get_mode":
            # Mode list from om1's own config; current mode from its logs.
            all_modes = OM1_STATE["config_modes"] or sorted(monitor.seen_modes)
            current = monitor.current_mode
            if current and current not in all_modes:
                all_modes = [*all_modes, current]
            await ws.send(
                json.dumps(
                    {
                        "request_id": request_id,
                        "code": 0,
                        "message": json.dumps(
                            {"all_modes": all_modes, "current_mode": current}
                        ),
                    }
                )
            )
        elif action == "switch_mode":
            # om1 drives its own mode transitions (person detection); there is
            # no external switch API on this deployment, so say so honestly
            # instead of pretending the switch happened.
            await ws.send(
                json.dumps(
                    {
                        "request_id": request_id,
                        "code": 1,
                        "message": "manual mode switching is not supported on this deployment",
                    }
                )
            )


ACTIVITY_MONITOR = ActivityMonitor()


async def handler(ws):
    peer = getattr(ws, "remote_address", None)
    print(f"avatar connected: {peer}", flush=True)

    cameras = CameraTracker()
    speaker = SpeakerTracker()
    scanner = HeldScanner()

    lidar = LidarTracker()
    pusher = asyncio.create_task(publish_loop(ws, cameras, speaker, scanner, lidar))
    activity = asyncio.create_task(activity_loop(ws, ACTIVITY_MONITOR))
    try:
        await answer_requests(ws, ACTIVITY_MONITOR)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        pusher.cancel()
        activity.cancel()
        print(f"avatar disconnected: {peer}", flush=True)


async def report_once():
    """Print one status snapshot to stdout and exit — for debugging."""
    cameras = CameraTracker()
    speaker = SpeakerTracker()
    scanner = HeldScanner()
    await scanner.refresh()
    snapshot = {
        **await cameras.status(scanner),
        "lidar": LidarTracker().status(scanner),
        "mic": mic_status(),
        "speaker": speaker.status(),
        "wifi": wifi_status(),
    }
    print(json.dumps(snapshot, indent=2))


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=6123)
    parser.add_argument("--once", action="store_true", help="print one snapshot and exit")
    args = parser.parse_args()

    if args.once:
        await report_once()
        return

    followers = [
        asyncio.create_task(follow_om1_logs(ACTIVITY_MONITOR)),
        asyncio.create_task(follow_om1_tracer(ACTIVITY_MONITOR)),
        asyncio.create_task(watch_om1_state()),
        asyncio.create_task(seed_current_mode(ACTIVITY_MONITOR)),
    ]
    try:
        async with websockets.serve(handler, args.host, args.port):
            print(f"om1 status bridge on ws://{args.host}:{args.port}", flush=True)
            await asyncio.Future()
    finally:
        for follower in followers:
            follower.cancel()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
