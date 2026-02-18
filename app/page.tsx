"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ═══════════════════════════════════════════════════════
   TYPES & CONSTANTS
   ═══════════════════════════════════════════════════════ */

type GameState = "idle" | "playing" | "paused" | "gameOver";
type HitSoundName = "hitmarker" | "squeak" | "scream" | "beep";

interface Settings {
  hitSound: HitSoundName;
  hitVolume: number;
  musicVolume: number;
  roundTime: number;
  targetCount: number;
  theme: "dark" | "light";
}

const GRID = 16;
const HIT_PTS = 100;
const MISS_PTS = 50;

const SOUND_OPTIONS: { value: HitSoundName; label: string }[] = [
  { value: "hitmarker", label: "Hitmarker" },
  { value: "squeak", label: "Squeak" },
  { value: "scream", label: "Scream" },
  { value: "beep", label: "Beep" },
];

const TIME_OPTIONS = [10, 30, 60];
const TARGET_OPTIONS = [3, 4, 5, 6];

const DEFAULTS: Settings = {
  hitSound: "hitmarker",
  hitVolume: 0.5,
  musicVolume: 0.3,
  roundTime: 60,
  targetCount: 3,
  theme: "dark",
};

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */

type PerfRating = {
  label: string;
  sound: "high" | "med" | "low";
  color: string;
};

function getPerformance(
  accuracy: number,
  score: number,
  roundTime: number
): PerfRating {
  if (accuracy >= 80 && score >= roundTime * 25)
    return { label: "LEGENDARY", sound: "high", color: "#fbbf24" };
  if (accuracy >= 60 && score >= roundTime * 15)
    return { label: "SHARP", sound: "high", color: "#22d3ee" };
  if (accuracy >= 40 || score >= roundTime * 8)
    return { label: "DECENT", sound: "med", color: "#a3a3a3" };
  return { label: "KEEP TRAINING", sound: "low", color: "#f87171" };
}

function spawnInitial(count: number): number[] {
  const set = new Set<number>();
  while (set.size < count) set.add(Math.floor(Math.random() * GRID));
  return Array.from(set);
}

function replaceTarget(current: number[], clicked: number): number[] {
  const rest = current.filter((t) => t !== clicked);
  let next: number;
  do {
    next = Math.floor(Math.random() * GRID);
  } while (rest.includes(next));
  return [...rest, next];
}

/* ═══════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════ */

export default function GridShotZero() {
  /* ─── Settings ─── */
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  /* ─── Game State ─── */
  const [gameState, setGameState] = useState<GameState>("idle");
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(DEFAULTS.roundTime);
  const [activeTargets, setActiveTargets] = useState<number[]>([]);
  const [totalClicks, setTotalClicks] = useState(0);
  const [hits, setHits] = useState(0);
  const [missFlash, setMissFlash] = useState(false);

  /* ─── Refs ─── */
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const targetsRef = useRef<number[]>([]);
  const hitPoolRef = useRef<HTMLAudioElement[]>([]);
  const hitPoolIdx = useRef(0);
  const resultFired = useRef(false);

  useEffect(() => {
    targetsRef.current = activeTargets;
  }, [activeTargets]);

  /* ─── Persist Settings ─── */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("gridshot-cfg");
      if (raw) {
        const parsed = JSON.parse(raw);
        setSettings((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("gridshot-cfg", JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  /* ─── Theme ─── */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  /* ─── Hit Sound Pool (pre-create for zero-latency playback) ─── */
  useEffect(() => {
    hitPoolRef.current = Array.from({ length: 10 }, () => {
      const a = new Audio(`/audio/${settings.hitSound}.mp3`);
      a.volume = settings.hitVolume;
      return a;
    });
    return () =>
      hitPoolRef.current.forEach((a) => {
        a.pause();
        a.src = "";
      });
  }, [settings.hitSound]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    hitPoolRef.current.forEach((a) => {
      a.volume = settings.hitVolume;
    });
  }, [settings.hitVolume]);

  const playHit = useCallback(() => {
    const p = hitPoolRef.current;
    if (!p.length) return;
    const a = p[hitPoolIdx.current % p.length];
    a.currentTime = 0;
    a.play().catch(() => {});
    hitPoolIdx.current++;
  }, []);

  const playOneShot = useCallback((src: string, vol: number) => {
    try {
      const a = new Audio(src);
      a.volume = Math.max(0, Math.min(1, vol));
      a.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }, []);

  /* ─── Background Music ─── */
  useEffect(() => {
    const m = new Audio("/audio/background.mp3");
    m.loop = true;
    m.volume = settings.musicVolume;
    musicRef.current = m;
    return () => {
      m.pause();
      m.src = "";
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (musicRef.current) musicRef.current.volume = settings.musicVolume;
  }, [settings.musicVolume]);

  /* ─── Timer Management ─── */
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // End game when timer hits 0
  useEffect(() => {
    if (gameState === "playing" && timeLeft === 0) {
      setGameState("gameOver");
      setActiveTargets([]);
      targetsRef.current = [];
      stopTimer();
      musicRef.current?.pause();
      resultFired.current = false;
    }
  }, [timeLeft, gameState, stopTimer]);

  /* ─── Result Sound ─── */
  useEffect(() => {
    if (gameState === "gameOver" && !resultFired.current) {
      resultFired.current = true;
      const acc = totalClicks > 0 ? (hits / totalClicks) * 100 : 0;
      const { sound } = getPerformance(
        acc,
        score,
        settingsRef.current.roundTime
      );
      playOneShot(`/audio/${sound}.mp3`, settingsRef.current.hitVolume);
    }
  }, [gameState]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Game Actions ─── */
  const startGame = useCallback(() => {
    const t = spawnInitial(settingsRef.current.targetCount);
    setScore(0);
    setTotalClicks(0);
    setHits(0);
    setTimeLeft(settingsRef.current.roundTime);
    setActiveTargets(t);
    targetsRef.current = t;
    resultFired.current = false;
    setShowSettings(false);
    setGameState("playing");

    musicRef.current?.play().catch(() => {});
    stopTimer();
    timerRef.current = setInterval(
      () => setTimeLeft((p) => Math.max(0, p - 1)),
      1000
    );
  }, [stopTimer]);

  const pauseGame = useCallback(() => {
    if (gameState !== "playing") return;
    setGameState("paused");
    stopTimer();
    musicRef.current?.pause();
  }, [gameState, stopTimer]);

  const resumeGame = useCallback(() => {
    if (gameState !== "paused") return;
    setGameState("playing");
    setShowSettings(false);
    musicRef.current?.play().catch(() => {});
    timerRef.current = setInterval(
      () => setTimeLeft((p) => Math.max(0, p - 1)),
      1000
    );
  }, [gameState]);

  const quitGame = useCallback(() => {
    setGameState("idle");
    setActiveTargets([]);
    targetsRef.current = [];
    setTimeLeft(settingsRef.current.roundTime);
    stopTimer();
    musicRef.current?.pause();
    setShowSettings(false);
  }, [stopTimer]);

  const handleCellClick = useCallback(
    (index: number) => {
      if (gameState !== "playing") return;
      setTotalClicks((p) => p + 1);

      if (targetsRef.current.includes(index)) {
        // HIT
        playHit();
        setScore((p) => p + HIT_PTS);
        setHits((p) => p + 1);
        const updated = replaceTarget(targetsRef.current, index);
        setActiveTargets(updated);
        targetsRef.current = updated;
      } else {
        // MISS
        setScore((p) => Math.max(0, p - MISS_PTS));
        setMissFlash(true);
        setTimeout(() => setMissFlash(false), 150);
      }
    },
    [gameState, playHit]
  );

  /* ─── Keyboard ─── */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showSettings) setShowSettings(false);
        else if (gameState === "playing") pauseGame();
        else if (gameState === "paused") resumeGame();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [gameState, pauseGame, resumeGame, showSettings]);

  /* ─── Fullscreen ─── */
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }, []);

  /* ─── Computed Stats ─── */
  const accuracy =
    totalClicks > 0 ? Math.round((hits / totalClicks) * 100) : 0;
  const elapsed = settings.roundTime - timeLeft;
  const cps = elapsed > 0 ? (totalClicks / elapsed).toFixed(1) : "0.0";
  const perf = useMemo(
    () => getPerformance(accuracy, score, settings.roundTime),
    [accuracy, score, settings.roundTime]
  );
  const timerPct = (timeLeft / settings.roundTime) * 100;

  /* ─── Settings Updater ─── */
  const updateSetting = <K extends keyof Settings>(
    key: K,
    value: Settings[K]
  ) => setSettings((prev) => ({ ...prev, [key]: value }));

  /* ─── Cleanup ─── */
  useEffect(
    () => () => {
      stopTimer();
      musicRef.current?.pause();
    },
    [stopTimer]
  );

  /* ═══════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════ */

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden"
      style={{
        background: "var(--bg-primary)",
        fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
      }}
    >
      {/* ══════════ HUD (during gameplay) ══════════ */}
      {(gameState === "playing" || gameState === "paused") && (
        <header
          className="fixed top-0 left-0 right-0 z-30 px-4 md:px-6 py-3"
          style={{
            background: "var(--bg-secondary)",
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
            {/* Left: Logo + stats */}
            <div className="flex items-center gap-4 md:gap-6 flex-wrap">
              <span
                className="text-base md:text-lg font-black tracking-tighter"
                style={{ color: "var(--accent)" }}
              >
                GRIDSHOT.ZERO
              </span>
              <div
                className="flex gap-3 md:gap-5 text-xs md:text-sm"
                style={{ color: "var(--text-secondary)" }}
              >
                <span>
                  SCORE{" "}
                  <strong style={{ color: "var(--text-primary)" }}>
                    {score}
                  </strong>
                </span>
                <span>
                  ACC{" "}
                  <strong
                    style={{
                      color:
                        accuracy >= 60
                          ? "var(--success)"
                          : accuracy >= 40
                            ? "var(--warning)"
                            : "var(--danger)",
                    }}
                  >
                    {accuracy}%
                  </strong>
                </span>
                <span>
                  CPS{" "}
                  <strong style={{ color: "var(--text-primary)" }}>
                    {cps}
                  </strong>
                </span>
              </div>
            </div>

            {/* Right: Timer + pause */}
            <div className="flex items-center gap-3">
              <div
                className="text-xl md:text-2xl font-bold tabular-nums"
                style={{
                  color:
                    timeLeft <= 10 ? "var(--danger)" : "var(--text-primary)",
                }}
              >
                {timeLeft}s
              </div>
              <button
                onClick={pauseGame}
                className="px-3 py-1.5 text-xs rounded-lg transition-colors cursor-pointer"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                }}
              >
                ⏸ ESC
              </button>
            </div>
          </div>

          {/* Timer progress bar */}
          <div
            className="max-w-3xl mx-auto mt-2 h-1 rounded-full overflow-hidden"
            style={{ background: "var(--bg-tertiary)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-1000 ease-linear"
              style={{
                width: `${timerPct}%`,
                background:
                  timeLeft <= 10 ? "var(--danger)" : "var(--accent)",
              }}
            />
          </div>
        </header>
      )}

      {/* ══════════ THE GRID (4×4) ══════════ */}
      <div
        className={`grid grid-cols-4 gap-2 md:gap-3 p-3 md:p-4 rounded-2xl transition-all duration-200 ${
          gameState === "playing" ? "cursor-crosshair" : ""
        }`}
        style={{
          background: "var(--bg-secondary)",
          border: `2px solid ${missFlash ? "var(--danger)" : "var(--border-color)"}`,
          boxShadow: missFlash
            ? "0 0 30px rgba(248, 113, 113, 0.3)"
            : "0 0 60px rgba(0,0,0,0.3)",
          marginTop:
            gameState === "playing" || gameState === "paused"
              ? "50px"
              : "0",
        }}
      >
        {Array.from({ length: GRID }, (_, i) => {
          const isTarget = activeTargets.includes(i);
          return (
            <button
              key={i}
              onClick={() => handleCellClick(i)}
              disabled={gameState !== "playing"}
              className={`w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem] md:w-24 md:h-24 rounded-xl relative overflow-hidden transition-colors duration-100 focus:outline-none ${
                gameState === "playing"
                  ? "cursor-crosshair active:scale-95"
                  : ""
              }`}
              style={{ background: "var(--bg-cell)" }}
              onMouseEnter={(e) => {
                if (gameState === "playing")
                  e.currentTarget.style.background = "var(--bg-cell-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-cell)";
              }}
            >
              {isTarget && (
                <div
                  className="absolute inset-0 m-1.5 sm:m-2 rounded-full animate-scale-in"
                  style={{
                    background: "var(--accent)",
                    boxShadow: `0 0 20px var(--target-glow), inset 0 0 12px rgba(255,255,255,0.15)`,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ══════════ IDLE OVERLAY ══════════ */}
      {gameState === "idle" && (
        <div
          className="fixed inset-0 z-40 flex flex-col items-center justify-center backdrop-blur-md animate-fade-in px-4"
          style={{ background: "var(--overlay-bg)" }}
        >
          <h1
            className="text-4xl sm:text-5xl md:text-7xl font-black tracking-tighter mb-1"
            style={{ color: "var(--accent)" }}
          >
            GRIDSHOT
            <span style={{ color: "var(--text-primary)" }}>.ZERO</span>
          </h1>
          <p
            className="text-xs sm:text-sm mb-8 tracking-widest uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            A bored GabTzy Project
          </p>

          {/* Quick settings preview */}
          <div
            className="flex gap-4 md:gap-6 mb-8 text-xs sm:text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            <span>⏱ {settings.roundTime}s</span>
            <span>◎ {settings.targetCount} targets</span>
            <span>
              🔊{" "}
              {SOUND_OPTIONS.find((s) => s.value === settings.hitSound)?.label}
            </span>
          </div>

          <button
            onClick={startGame}
            className="px-8 md:px-10 py-3 md:py-4 text-lg md:text-xl font-black rounded-lg transition-all duration-150 hover:scale-105 active:scale-95 mb-4 cursor-pointer"
            style={{ background: "var(--accent)", color: "var(--bg-primary)" }}
          >
            START SCENARIO
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="px-6 py-2 text-sm rounded-lg transition-colors cursor-pointer"
            style={{
              color: "var(--text-secondary)",
              background: "var(--bg-tertiary)",
            }}
          >
            ⚙ Settings
          </button>
        </div>
      )}

      {/* ══════════ PAUSED OVERLAY ══════════ */}
      {gameState === "paused" && (
        <div
          className="fixed inset-0 z-40 flex flex-col items-center justify-center backdrop-blur-md animate-fade-in px-4"
          style={{ background: "var(--overlay-bg)" }}
        >
          <h2
            className="text-4xl md:text-5xl font-black mb-2"
            style={{ color: "var(--text-primary)" }}
          >
            PAUSED
          </h2>
          <p className="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
            {timeLeft}s remaining · Score: {score}
          </p>

          <div className="flex flex-col gap-3 w-56">
            <button
              onClick={resumeGame}
              className="px-6 py-3 font-bold rounded-lg transition-all hover:scale-105 active:scale-95 cursor-pointer"
              style={{
                background: "var(--accent)",
                color: "var(--bg-primary)",
              }}
            >
              RESUME
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="px-6 py-3 font-bold rounded-lg transition-colors cursor-pointer"
              style={{
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
              }}
            >
              ⚙ SETTINGS
            </button>
            <button
              onClick={quitGame}
              className="px-6 py-3 font-bold rounded-lg transition-colors cursor-pointer"
              style={{
                background: "transparent",
                color: "var(--danger)",
                border: "1px solid var(--danger)",
              }}
            >
              QUIT
            </button>
          </div>

          <p
            className="mt-6 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Press ESC to resume
          </p>
        </div>
      )}

      {/* ══════════ GAME OVER OVERLAY ══════════ */}
      {gameState === "gameOver" && (
        <div
          className="fixed inset-0 z-40 flex flex-col items-center justify-center backdrop-blur-md animate-fade-in px-4"
          style={{ background: "var(--overlay-bg)" }}
        >
          {/* Performance rating */}
          <p
            className="text-base md:text-lg font-bold tracking-widest uppercase mb-2"
            style={{ color: perf.color }}
          >
            {perf.label}
          </p>

          <h2
            className="text-5xl md:text-6xl font-black mb-1"
            style={{ color: "var(--text-primary)" }}
          >
            {score}
          </h2>
          <p
            className="text-sm mb-8"
            style={{ color: "var(--text-muted)" }}
          >
            FINAL SCORE
          </p>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-x-10 md:gap-x-14 gap-y-4 mb-8 text-center">
            <div>
              <div
                className="text-xl md:text-2xl font-bold"
                style={{
                  color:
                    accuracy >= 60
                      ? "var(--success)"
                      : accuracy >= 40
                        ? "var(--warning)"
                        : "var(--danger)",
                }}
              >
                {accuracy}%
              </div>
              <div
                className="text-[10px] md:text-xs uppercase"
                style={{ color: "var(--text-muted)" }}
              >
                Accuracy
              </div>
            </div>
            <div>
              <div
                className="text-xl md:text-2xl font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                {hits}
              </div>
              <div
                className="text-[10px] md:text-xs uppercase"
                style={{ color: "var(--text-muted)" }}
              >
                Hits
              </div>
            </div>
            <div>
              <div
                className="text-xl md:text-2xl font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                {totalClicks - hits}
              </div>
              <div
                className="text-[10px] md:text-xs uppercase"
                style={{ color: "var(--text-muted)" }}
              >
                Misses
              </div>
            </div>
            <div>
              <div
                className="text-xl md:text-2xl font-bold"
                style={{ color: "var(--text-primary)" }}
              >
                {cps}
              </div>
              <div
                className="text-[10px] md:text-xs uppercase"
                style={{ color: "var(--text-muted)" }}
              >
                Clicks/sec
              </div>
            </div>
          </div>

          <button
            onClick={startGame}
            className="px-8 md:px-10 py-3 md:py-4 text-lg md:text-xl font-black rounded-lg transition-all hover:scale-105 active:scale-95 mb-3 cursor-pointer"
            style={{ background: "var(--accent)", color: "var(--bg-primary)" }}
          >
            PLAY AGAIN
          </button>
          <button
            onClick={quitGame}
            className="px-6 py-2 text-sm rounded-lg transition-colors cursor-pointer"
            style={{
              color: "var(--text-secondary)",
              background: "var(--bg-tertiary)",
            }}
          >
            MAIN MENU
          </button>
        </div>
      )}

      {/* ══════════ SETTINGS PANEL ══════════ */}
      {showSettings && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setShowSettings(false)}
          />

          {/* Panel */}
          <div
            className="fixed right-0 top-0 bottom-0 w-72 sm:w-80 z-50 overflow-y-auto p-5 md:p-6 animate-slide-in"
            style={{
              background: "var(--bg-secondary)",
              borderLeft: "1px solid var(--border-color)",
            }}
          >
            <div className="flex items-center justify-between mb-6">
              <h3
                className="text-lg font-bold"
                style={{ color: "var(--accent)" }}
              >
                SETTINGS
              </h3>
              <button
                onClick={() => setShowSettings(false)}
                className="text-xl leading-none cursor-pointer"
                style={{ color: "var(--text-muted)" }}
              >
                ✕
              </button>
            </div>

            {/* Hit Sound */}
            <SettingGroup label="Hit Sound">
              <select
                value={settings.hitSound}
                onChange={(e) =>
                  updateSetting("hitSound", e.target.value as HitSoundName)
                }
                className="w-full px-3 py-2 rounded-lg text-sm outline-none cursor-pointer"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-color)",
                }}
              >
                {SOUND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </SettingGroup>

            {/* Sound Effects Volume */}
            <SettingGroup
              label={`Sound Effects — ${Math.round(settings.hitVolume * 100)}%`}
            >
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.hitVolume}
                onChange={(e) =>
                  updateSetting("hitVolume", parseFloat(e.target.value))
                }
                className="w-full"
              />
            </SettingGroup>

            {/* Music Volume */}
            <SettingGroup
              label={`Music — ${Math.round(settings.musicVolume * 100)}%`}
            >
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.musicVolume}
                onChange={(e) =>
                  updateSetting("musicVolume", parseFloat(e.target.value))
                }
                className="w-full"
              />
            </SettingGroup>

            {/* Round Time */}
            <SettingGroup label="Round Time">
              <div className="flex gap-2">
                {TIME_OPTIONS.map((t) => (
                  <ToggleButton
                    key={t}
                    active={settings.roundTime === t}
                    onClick={() => updateSetting("roundTime", t)}
                  >
                    {t}s
                  </ToggleButton>
                ))}
              </div>
            </SettingGroup>

            {/* Target Count */}
            <SettingGroup label="Targets">
              <div className="flex gap-2">
                {TARGET_OPTIONS.map((n) => (
                  <ToggleButton
                    key={n}
                    active={settings.targetCount === n}
                    onClick={() => updateSetting("targetCount", n)}
                  >
                    {n}
                  </ToggleButton>
                ))}
              </div>
            </SettingGroup>

            {/* Theme */}
            <SettingGroup label="Theme">
              <div className="flex gap-2">
                <ToggleButton
                  active={settings.theme === "dark"}
                  onClick={() => updateSetting("theme", "dark")}
                >
                  🌙 Dark
                </ToggleButton>
                <ToggleButton
                  active={settings.theme === "light"}
                  onClick={() => updateSetting("theme", "light")}
                >
                  ☀️ Light
                </ToggleButton>
              </div>
            </SettingGroup>

            {/* Fullscreen */}
            <div className="mb-4">
              <button
                onClick={toggleFullscreen}
                className="w-full py-2.5 rounded-lg text-sm font-bold transition-colors cursor-pointer"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                }}
              >
                ⛶ Toggle Fullscreen
              </button>
            </div>

            {/* Preview Hit Sound */}
            <div className="mb-4">
              <button
                onClick={() =>
                  playOneShot(
                    `/audio/${settings.hitSound}.mp3`,
                    settings.hitVolume
                  )
                }
                className="w-full py-2.5 rounded-lg text-sm font-bold transition-colors cursor-pointer"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                }}
              >
                🔊 Preview Hit Sound
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

/* ═══════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════ */

function SettingGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <label
        className="text-[10px] md:text-xs font-bold uppercase tracking-wider mb-2 block"
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer"
      style={{
        background: active ? "var(--accent)" : "var(--bg-tertiary)",
        color: active ? "var(--bg-primary)" : "var(--text-secondary)",
      }}
    >
      {children}
    </button>
  );
}
