// main.js
// Timer logic and UI wiring for Pulse Clock.
// Uses performance.now() for monotonic timing and WebAudio for beeps.

// Limits and defaults
// MAX_TOTAL_SECONDS caps the timer to 23:59:59 to prevent overflow.
// MIN_SECONDS ensures at least a 1-second timer/interval.
const MAX_TOTAL_SECONDS = 23 * 3600 + 59 * 60 + 59;
const MIN_SECONDS = 1;

// Runtime state and config
// state.config holds current input values and selected input modes.
const state = {
  timer: null,
  timerInputElements: null,
  config: {
    timerMode: "hms",
    intervalMode: "hms",
    timer: { h: 0, m: 0, s: 1 },
    interval: { h: 0, m: 0, s: 0 },
    timerValue: 60,
    intervalValue: 60,
  },
  audio: {
    context: null,
    enabled: false,
  },
};

const dom = {
  stateBadge: document.getElementById("stateBadge"),
  nextBeep: document.getElementById("nextBeep"),
  progressBar: document.getElementById("progressBar"),
  timerInputs: document.getElementById("timerInputs"),
  intervalInputs: document.getElementById("intervalInputs"),
  startBtn: document.getElementById("startBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  resetBtn: document.getElementById("resetBtn"),
  pulsePanel: document.getElementById("pulsePanel"),
  errorMsg: document.getElementById("errorMsg"),
  msDisplay: document.getElementById("msDisplay"),
};

// Formatting helpers
// formatTimeWithMs: human-readable HH:MM:SS.mmm for running display.
// formatTime: HH:MM:SS (used in inputs and next-beep display).
const formatMsTwoDigits = (ms) => {
  const totalMs = Math.max(0, Math.round(ms));
  const twoDigits = Math.floor((totalMs % 1000) / 10);
  return `.${String(twoDigits).padStart(2, "0")}`;
};

const formatTime = (ms) => {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const pad2 = (value) => String(value).padStart(2, "0");

const hmsToSeconds = ({ h, m, s }) => h * 3600 + m * 60 + s;
const secondsToHms = (totalSeconds) => {
  const safeSeconds = clamp(Math.round(totalSeconds), 0, MAX_TOTAL_SECONDS);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = safeSeconds % 60;
  return { h, m, s };
};

const getTimerModeRadios = () => Array.from(document.querySelectorAll("input[name='timerMode']"));
const getIntervalModeRadios = () => Array.from(document.querySelectorAll("input[name='intervalMode']"));

const getIsLocked = () => state.timer && state.timer.state !== "idle";

const applyInputLock = (locked) => {
  [...dom.timerInputs.querySelectorAll("input, button"), ...dom.intervalInputs.querySelectorAll("input, button")].forEach(
    (element) => {
      element.disabled = locked;
    }
  );
  [...getTimerModeRadios(), ...getIntervalModeRadios()].forEach((radio) => {
    radio.disabled = locked;
  });
};

const setError = (message) => {
  if (!dom.errorMsg) return;
  dom.errorMsg.textContent = message;
};

const clearError = () => {
  if (!dom.errorMsg) return;
  dom.errorMsg.textContent = "";
};

// Audio helpers
// initAudio(): create/resume AudioContext on first user gesture.
// playBeep(): short interval beep.
// playFinishBeep(): two-tone finish notification.
const initAudio = () => {
  if (!state.audio.context) {
    state.audio.context = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audio.context.state === "suspended") {
    state.audio.context.resume();
  }
  state.audio.enabled = true;
};

// Visual feedback
// Briefly add a class to the panel when a beep occurs.
const flashPulsePanel = () => {
  if (!dom.pulsePanel) return;
  dom.pulsePanel.classList.add("beep-flash");
  window.setTimeout(() => {
    dom.pulsePanel.classList.remove("beep-flash");
  }, 180);
};

const playBeep = ({ duration = 150, frequency = 880, gain = 0.12 } = {}) => {
  if (!state.audio.context || !state.audio.enabled) return;
  const ctx = state.audio.context;
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gainNode.gain.value = gain;
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + duration / 1000);
};

const playFinishBeep = () => {
  playBeep({ duration: 160, frequency: 880, gain: 0.14 });
  window.setTimeout(() => {
    playBeep({ duration: 200, frequency: 660, gain: 0.14 });
  }, 180);
};

// Input sanitizer
// Prevents non-digits from being entered. Uses beforeinput/keydown to block invalid chars.
const preventNonNumericInput = (input) => {
  input.addEventListener("beforeinput", (event) => {
    if (event.inputType === "deleteContentBackward" || event.inputType === "deleteContentForward") return;
    if (event.data && !/^\d+$/.test(event.data)) {
      event.preventDefault();
    }
  });

  input.addEventListener("keydown", (event) => {
    const allowed = ["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Home", "End"];
    if (allowed.includes(event.key)) return;
    if (/^\d$/.test(event.key)) return;
    event.preventDefault();
  });

  input.addEventListener("input", (event) => {
    const sanitized = event.target.value.replace(/\D/g, "");
    if (sanitized !== event.target.value) {
      event.target.value = sanitized;
    }
  });
};

// Long-press helper
// Calls stepFn once, then starts an interval after a short delay for repeated steps.
const createStepHandlers = (button, stepFn) => {
  let holdTimeout = null;
  let holdInterval = null;

  const clearTimers = () => {
    if (holdTimeout) window.clearTimeout(holdTimeout);
    if (holdInterval) window.clearInterval(holdInterval);
    holdTimeout = null;
    holdInterval = null;
  };

  const startHold = (event) => {
    if (button.disabled) return;
    event.preventDefault();
    stepFn();
    holdTimeout = window.setTimeout(() => {
      holdInterval = window.setInterval(stepFn, 80);
    }, 350);
  };

  button.addEventListener("pointerdown", startHold);
  button.addEventListener("pointerup", clearTimers);
  button.addEventListener("pointerleave", clearTimers);
  button.addEventListener("pointercancel", clearTimers);
};

const updateConfigFromInputs = () => {
  const timerSeconds = getTotalSeconds("timer");
  const intervalSeconds = getTotalSeconds("interval");
  const totalMs = timerSeconds * 1000;
  const intervalMs = intervalSeconds * 1000;

  clearError();
  if (state.timer) {
    state.timer.updateConfig(totalMs, intervalMs);
  }
  if (state.timer && state.timer.state === "idle") {
    updateTimerInputsFromMs(timerSeconds * 1000);
  }
};

const updateTimerInputsFromMs = (remainingMs) => {
  if (!state.timerInputElements) return;
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const mode = state.timerInputElements.mode;

  if (mode === "hms") {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (state.timerInputElements.h) state.timerInputElements.h.value = pad2(hours);
    if (state.timerInputElements.m) state.timerInputElements.m.value = pad2(minutes);
    if (state.timerInputElements.s) state.timerInputElements.s.value = pad2(seconds);
  } else if (mode === "minutes") {
    const minutes = Math.floor(totalSeconds / 60);
    if (state.timerInputElements.value) state.timerInputElements.value.value = String(minutes);
  } else if (mode === "seconds") {
    if (state.timerInputElements.value) state.timerInputElements.value.value = String(totalSeconds);
  }
};

const getTotalSeconds = (type) => {
  const mode = state.config[`${type}Mode`];
  const minSeconds = type === "interval" ? 0 : MIN_SECONDS;
  if (mode === "hms") {
    const value = hmsToSeconds(state.config[type]);
    const clamped = clamp(value, minSeconds, MAX_TOTAL_SECONDS);
    if (clamped !== value) {
      state.config[type] = secondsToHms(clamped);
    }
    return clamped;
  }

  if (mode === "minutes") {
    const maxMinutes = Math.floor(MAX_TOTAL_SECONDS / 60);
    const minMinutes = type === "interval" ? 0 : 1;
    const minutes = clamp(state.config[`${type}Value`], minMinutes, maxMinutes);
    state.config[`${type}Value`] = minutes;
    return minutes * 60;
  }

  const seconds = clamp(state.config[`${type}Value`], minSeconds, MAX_TOTAL_SECONDS);
  state.config[`${type}Value`] = seconds;
  return seconds;
};

const createArrowButton = (label, className) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    className || "flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-[10px] text-neutral-500";
  button.textContent = label;
  return button;
};

// UI builders
// createField: builds per-unit (HH/MM/SS) input with ▲/▼ buttons and long-press.
// createSingleInput: builds a single numeric field for minutes or seconds modes.
const createField = ({
  label,
  value,
  max,
  onChange,
  ariaLabel,
  inputClassName,
  wrapperClassName,
  labelClassName,
  buttonClassName,
  inputRowClassName,
  showLabel = true,
}) => {
  const wrapper = document.createElement("div");
  wrapper.className = wrapperClassName || "rounded-2xl border border-neutral-200 px-4 py-3";
  const labelEl = document.createElement("div");
  labelEl.className = labelClassName || "text-[10px] uppercase tracking-[0.3em] text-neutral-400";
  labelEl.textContent = label;
  if (!showLabel) labelEl.classList.add("sr-only");

  const inputRow = document.createElement("div");
  inputRow.className = inputRowClassName || "mt-2 flex items-center justify-between gap-2";

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.pattern = "[0-9]*";
  input.maxLength = 2;
  input.className = `w-full bg-transparent font-semibold text-neutral-900 outline-none ${
    inputClassName || "text-lg"
  }`;
  input.value = pad2(value);
  input.setAttribute("aria-label", ariaLabel || label);
  preventNonNumericInput(input);

  input.addEventListener("blur", () => {
    let nextValue = parseInt(input.value || "0", 10);
    if (Number.isNaN(nextValue)) nextValue = 0;
    nextValue = clamp(nextValue, 0, max);
    input.value = pad2(nextValue);
    onChange(nextValue);
    updateConfigFromInputs();
  });

  input.addEventListener("input", () => {
    if (input.value.length === 0) return;
    let nextValue = parseInt(input.value, 10);
    if (Number.isNaN(nextValue)) return;
    if (nextValue > max) nextValue = max;
    input.value = String(nextValue);
    onChange(nextValue);
    updateConfigFromInputs();
  });

  const buttonGroup = document.createElement("div");
  buttonGroup.className = "flex flex-col gap-1";

  const upButton = createArrowButton("▲", buttonClassName);
  const downButton = createArrowButton("▼", buttonClassName);

  createStepHandlers(upButton, () => {
    const nextValue = clamp((parseInt(input.value || "0", 10) || 0) + 1, 0, max);
    input.value = pad2(nextValue);
    onChange(nextValue);
    updateConfigFromInputs();
  });

  createStepHandlers(downButton, () => {
    const nextValue = clamp((parseInt(input.value || "0", 10) || 0) - 1, 0, max);
    input.value = pad2(nextValue);
    onChange(nextValue);
    updateConfigFromInputs();
  });

  buttonGroup.appendChild(upButton);
  buttonGroup.appendChild(downButton);

  inputRow.appendChild(input);
  inputRow.appendChild(buttonGroup);
  wrapper.appendChild(labelEl);
  wrapper.appendChild(inputRow);
  return { wrapper, input };
};

const createSingleInput = ({
  label,
  value,
  max,
  min,
  onChange,
  ariaLabel,
  inputClassName,
  wrapperClassName,
  labelClassName,
  buttonClassName,
  inputRowClassName,
  showLabel = true,
}) => {
  const wrapper = document.createElement("div");
  wrapper.className = wrapperClassName || "rounded-2xl border border-neutral-200 px-4 py-3";

  const labelEl = document.createElement("div");
  labelEl.className = labelClassName || "text-[10px] uppercase tracking-[0.3em] text-neutral-400";
  labelEl.textContent = label;
  if (!showLabel) labelEl.classList.add("sr-only");

  const inputRow = document.createElement("div");
  inputRow.className = inputRowClassName || "mt-2 flex items-center justify-between gap-2";

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.pattern = "[0-9]*";
  input.maxLength = String(max).length;
  input.className = `w-full bg-transparent font-semibold text-neutral-900 outline-none ${
    inputClassName || "text-lg"
  }`;
  input.value = String(value);
  input.setAttribute("aria-label", ariaLabel || label);
  preventNonNumericInput(input);

  input.addEventListener("blur", () => {
    let nextValue = parseInt(input.value || "0", 10);
    if (Number.isNaN(nextValue)) nextValue = min;
    nextValue = clamp(nextValue, min, max);
    input.value = String(nextValue);
    onChange(nextValue);
    updateConfigFromInputs();
  });

  input.addEventListener("input", () => {
    if (input.value.length === 0) return;
    let nextValue = parseInt(input.value, 10);
    if (Number.isNaN(nextValue)) return;
    if (nextValue > max) nextValue = max;
    input.value = String(nextValue);
    onChange(nextValue);
    updateConfigFromInputs();
  });

  const buttonGroup = document.createElement("div");
  buttonGroup.className = "flex flex-col gap-1";

  const upButton = createArrowButton("▲", buttonClassName);
  const downButton = createArrowButton("▼", buttonClassName);

  createStepHandlers(upButton, () => {
    const nextValue = clamp((parseInt(input.value || "0", 10) || 0) + 1, min, max);
    input.value = String(nextValue);
    onChange(nextValue);
    updateConfigFromInputs();
  });

  createStepHandlers(downButton, () => {
    const nextValue = clamp((parseInt(input.value || "0", 10) || 0) - 1, min, max);
    input.value = String(nextValue);
    onChange(nextValue);
    updateConfigFromInputs();
  });

  buttonGroup.appendChild(upButton);
  buttonGroup.appendChild(downButton);

  inputRow.appendChild(input);
  inputRow.appendChild(buttonGroup);
  wrapper.appendChild(labelEl);
  wrapper.appendChild(inputRow);
  return { wrapper, input };
};

const renderInputs = (type) => {
  const container = type === "timer" ? dom.timerInputs : dom.intervalInputs;
  container.innerHTML = "";
  const mode = state.config[`${type}Mode`];
  const grid = document.createElement("div");
  const isTimer = type === "timer";
  const minSeconds = type === "interval" ? 0 : MIN_SECONDS;
  const inputClassName = isTimer
    ? "title-font w-16 sm:w-20 text-2xl sm:text-3xl text-neutral-800 tracking-tight text-center shadow-[0_1px_0_0_rgba(60,52,45,0.35)] focus:shadow-[0_2px_0_0_rgba(60,52,45,0.5)]"
    : "w-14 text-lg text-neutral-800 text-center shadow-[0_1px_0_0_rgba(60,52,45,0.25)] focus:shadow-[0_2px_0_0_rgba(60,52,45,0.45)]";
  const buttonClassName =
    "flex h-6 w-6 items-center justify-center text-[10px] text-neutral-400 transition hover:text-neutral-700";
  const wrapperClassName = "flex items-center gap-1";
  const inputRowClassName = "flex items-center gap-1";

  if (mode === "hms") {
    const { h, m, s } = state.config[type];
    const separator = () => {
      const span = document.createElement("span");
      span.className = isTimer
        ? "title-font text-4xl sm:text-5xl text-neutral-400"
        : "text-lg text-neutral-400";
      span.textContent = ":";
      return span;
    };

    grid.className = isTimer
      ? "flex items-center justify-center gap-3"
      : "flex items-center justify-center gap-3";

    const hoursField = createField({
      label: "HH",
      value: h,
      max: 23,
      ariaLabel: `${type} hours`,
      inputClassName,
      wrapperClassName,
      inputRowClassName,
      buttonClassName,
      showLabel: false,
      onChange: (value) => {
        state.config[type].h = value;
        updateConfigFromInputs();
      },
    });
    const minutesField = createField({
      label: "MM",
      value: m,
      max: 59,
      ariaLabel: `${type} minutes`,
      inputClassName,
      wrapperClassName,
      inputRowClassName,
      buttonClassName,
      showLabel: false,
      onChange: (value) => {
        state.config[type].m = value;
        updateConfigFromInputs();
      },
    });
    const secondsField = createField({
      label: "SS",
      value: s,
      max: 59,
      ariaLabel: `${type} seconds`,
      inputClassName,
      wrapperClassName,
      inputRowClassName,
      buttonClassName,
      showLabel: false,
      onChange: (value) => {
        state.config[type].s = value;
        updateConfigFromInputs();
      },
    });

    grid.appendChild(hoursField.wrapper);
    grid.appendChild(separator());
    grid.appendChild(minutesField.wrapper);
    grid.appendChild(separator());
    grid.appendChild(secondsField.wrapper);

    if (isTimer) {
      state.timerInputElements = {
        mode: "hms",
        h: hoursField.input,
        m: minutesField.input,
        s: secondsField.input,
      };
      if (state.timer && state.timer.state === "idle") {
        updateTimerInputsFromMs(getTotalSeconds("timer") * 1000);
      }
    }
  } else if (mode === "minutes") {
    grid.className = "flex items-center justify-center";
    const maxMinutes = Math.floor(MAX_TOTAL_SECONDS / 60);
    const minMinutes = 1;
    const value = clamp(state.config[`${type}Value`], minMinutes, maxMinutes);
    state.config[`${type}Value`] = value;
    const minutesField = createSingleInput({
      label: "Minutes",
      value,
      max: maxMinutes,
      min: minMinutes,
      ariaLabel: `${type} minutes`,
      inputClassName,
      wrapperClassName,
      inputRowClassName,
      buttonClassName,
      showLabel: false,
      onChange: (nextValue) => {
        state.config[`${type}Value`] = nextValue;
      },
    });
    const suffix = document.createElement("span");
    suffix.className = "text-xs uppercase tracking-[0.25em] text-neutral-500";
    suffix.textContent = "minutes";
    grid.appendChild(minutesField.wrapper);
    grid.appendChild(suffix);

    if (isTimer) {
      state.timerInputElements = {
        mode: "minutes",
        value: minutesField.input,
      };
      if (state.timer && state.timer.state === "idle") {
        updateTimerInputsFromMs(getTotalSeconds("timer") * 1000);
      }
    }
  } else {
    grid.className = "flex items-center justify-center";
    const value = clamp(state.config[`${type}Value`], minSeconds, MAX_TOTAL_SECONDS);
    state.config[`${type}Value`] = value;
    const secondsField = createSingleInput({
      label: "Seconds",
      value,
      max: MAX_TOTAL_SECONDS,
      min: minSeconds,
      ariaLabel: `${type} seconds`,
      inputClassName,
      wrapperClassName,
      inputRowClassName,
      buttonClassName,
      showLabel: false,
      onChange: (nextValue) => {
        state.config[`${type}Value`] = nextValue;
      },
    });
    const suffix = document.createElement("span");
    suffix.className = "text-xs uppercase tracking-[0.25em] text-neutral-500";
    suffix.textContent = "seconds";
    grid.appendChild(secondsField.wrapper);
    grid.appendChild(suffix);

    if (isTimer) {
      state.timerInputElements = {
        mode: "seconds",
        value: secondsField.input,
      };
      if (state.timer && state.timer.state === "idle") {
        updateTimerInputsFromMs(getTotalSeconds("timer") * 1000);
      }
    }
  }

  container.appendChild(grid);
  applyInputLock(getIsLocked());
};

const setMode = (type, mode) => {
  if (getIsLocked()) {
    const radios = type === "timer" ? getTimerModeRadios() : getIntervalModeRadios();
    radios.forEach((radio) => {
      radio.checked = radio.value === state.config[`${type}Mode`];
    });
    return;
  }

  const currentMode = state.config[`${type}Mode`];
  if (currentMode === mode) return;
  const totalSeconds = getTotalSeconds(type);

  state.config[`${type}Mode`] = mode;
  if (mode === "hms") {
    state.config[type] = secondsToHms(totalSeconds);
  } else if (mode === "minutes") {
    state.config[`${type}Value`] = clamp(Math.round(totalSeconds / 60), 1, Math.floor(MAX_TOTAL_SECONDS / 60));
  } else {
    state.config[`${type}Value`] = clamp(Math.round(totalSeconds), MIN_SECONDS, MAX_TOTAL_SECONDS);
  }
  renderInputs(type);
  updateConfigFromInputs();
};

/* TimerCore
 - totalMs, intervalMs: configured durations in ms.
 - Uses performance.now()+remainingMs to compute endTime (avoids tick drift).
 - Emits: onTick(remainingMs, state), onBeep(), onFinish().
 - lastBeepIndex tracks fired intervals to avoid duplicates.
*/
class TimerCore {
  constructor({ totalMs, intervalMs, onTick, onBeep, onFinish }) {
    this.totalMs = totalMs;
    this.intervalMs = intervalMs;
    this.onTick = onTick;
    this.onBeep = onBeep;
    this.onFinish = onFinish;

    this.state = "idle";
    this.remainingMs = totalMs;
    this.endTime = null;
    this.lastBeepIndex = 0;
    this.tickHandle = null;
  }

  // start(): begin or resume countdown
  start() {
    if (this.state === "running") return;
    if (this.state === "finished" || this.state === "idle") {
      this.remainingMs = this.totalMs;
      this.lastBeepIndex = 0;
    }

    this.state = "running";
    this.endTime = performance.now() + this.remainingMs;
    this._tick();
    this._startLoop();
  }

  // pause(): pause and keep remaining time
  pause() {
    if (this.state !== "running") return;
    this._stopLoop();
    this.remainingMs = Math.max(0, this.endTime - performance.now());
    this.state = "paused";
    this._emitTick();
  }

  // stop() removed: use pause() instead

  // reset(totalMs, intervalMs): set new config and go idle
  reset(totalMs, intervalMs) {
    if (typeof totalMs === "number") this.totalMs = totalMs;
    if (typeof intervalMs === "number") this.intervalMs = intervalMs;
    this._stopLoop();
    this.remainingMs = this.totalMs;
    this.lastBeepIndex = 0;
    this.state = "idle";
    this._emitTick();
  }

  // updateConfig(totalMs, intervalMs): change config only when idle
  updateConfig(totalMs, intervalMs) {
    if (this.state === "running" || this.state === "paused") return;
    this.totalMs = totalMs;
    this.intervalMs = intervalMs;
    this.remainingMs = totalMs;
    this.lastBeepIndex = 0;
    this._emitTick();
  }

  _startLoop() {
    if (this.tickHandle) return;
    this.tickHandle = window.setInterval(() => this._tick(), 60);
  }

  _stopLoop() {
    if (!this.tickHandle) return;
    window.clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  _tick() {
    if (this.state !== "running") return;
    const now = performance.now();
    this.remainingMs = Math.max(0, this.endTime - now);
    const elapsedMs = Math.max(0, this.totalMs - this.remainingMs);

    if (this.intervalMs > 0 && elapsedMs >= this.intervalMs && elapsedMs < this.totalMs) {
      const currentIndex = Math.floor(elapsedMs / this.intervalMs);
      if (currentIndex > this.lastBeepIndex) {
        const beepsToEmit = currentIndex - this.lastBeepIndex;
        this.lastBeepIndex = currentIndex;
        if (this.onBeep) {
          for (let i = 0; i < beepsToEmit; i += 1) {
            this.onBeep(false);
          }
        }
      }
    }

    // If timer reached zero, change state first and emit a final tick
    if (this.remainingMs <= 0) {
      this._stopLoop();
      this.remainingMs = 0;
      this.state = "finished";
      // notify UI about the finished state before calling onFinish
      this._emitTick();
      if (this.onFinish) this.onFinish();
      return;
    }

    this._emitTick();
  }

  _emitTick() {
    if (this.onTick) this.onTick(this.remainingMs, this.state);
  }
}

const initTimerCore = () => {
  state.timer = new TimerCore({
    totalMs: getTotalSeconds("timer") * 1000,
    intervalMs: getTotalSeconds("interval") * 1000,
    onTick: (remainingMs, status) => {
      dom.stateBadge.textContent = status[0].toUpperCase() + status.slice(1);
      const isIdle = status === "idle";
      if (!isIdle) {
        updateTimerInputsFromMs(remainingMs);
      }
      if (dom.msDisplay) {
        dom.msDisplay.textContent = status === "running" ? formatMsTwoDigits(remainingMs) : ".00";
        // toggle subtle opacity to make ms changes feel smoother
        const current = dom.msDisplay.style.opacity || "1";
        dom.msDisplay.style.opacity = current === "1" ? "0.6" : "1";
      }
      updateControlsVisibility(status);
      const totalMs = state.timer.totalMs || 1;
      const progress = Math.min(1, Math.max(0, 1 - remainingMs / totalMs));
      dom.progressBar.style.width = `${progress * 100}%`;

      if (status === "running") {
        const elapsed = Math.max(0, totalMs - remainingMs);
        const interval = state.timer.intervalMs;
        if (interval > 0) {
          const nextIndex = Math.floor(elapsed / interval) + 1;
          const nextInMs = Math.max(0, nextIndex * interval - elapsed);
          if (nextInMs > remainingMs) {
            dom.nextBeep.textContent = "Next: --:--";
          } else {
            dom.nextBeep.textContent = `Next: ${formatTime(nextInMs)}`;
          }
        } else {
          dom.nextBeep.textContent = "Next: --:--";
        }
      } else {
        dom.nextBeep.textContent = "Next: --:--";
      }
    },
    onBeep: () => {
      playBeep();
      flashPulsePanel();
    },
    onFinish: () => {
      playFinishBeep();
      flashPulsePanel();

      // After finishing, immediately reset to the configured initial values
      // and unlock inputs so the UI returns to idle state.
      // Use setTimeout 0 to ensure UI updates after the finish handlers run.
      setTimeout(() => {
        // reset keeps current configured total and interval
        state.timer.reset(state.timer.totalMs, state.timer.intervalMs);
        applyInputLock(false);
        clearError();
      }, 0);
    },
  });
};

const updateControlsVisibility = (status) => {
  const showStart = status === "idle" || status === "paused" || status === "finished";
  const showPause = status === "running";
  const showReset = status === "paused" || status === "finished";

  dom.startBtn.classList.toggle("hidden", !showStart);
  dom.pauseBtn.classList.toggle("hidden", !showPause);
  dom.resetBtn.classList.toggle("hidden", !showReset);
};

const bindModeControls = () => {
  getTimerModeRadios().forEach((radio) => {
    radio.addEventListener("change", () => setMode("timer", radio.value));
  });

  getIntervalModeRadios().forEach((radio) => {
    radio.addEventListener("change", () => setMode("interval", radio.value));
  });
};

const syncInputsWithConfig = () => {
  renderInputs("timer");
  renderInputs("interval");
  updateConfigFromInputs();
};

const ensureValidConfig = () => {
  getTotalSeconds("timer");
  getTotalSeconds("interval");
  renderInputs("timer");
  renderInputs("interval");
};

dom.startBtn.addEventListener("click", () => {
  initAudio();
  ensureValidConfig();
  updateConfigFromInputs();
  const timerSeconds = getTotalSeconds("timer");
  const intervalSeconds = getTotalSeconds("interval");
  if (intervalSeconds > 0 && intervalSeconds > timerSeconds) {
    setError("Interval must be less than or equal to timer.");
    const intervalInput = dom.intervalInputs.querySelector("input");
    if (intervalInput) intervalInput.focus();
    return;
  }
  state.timer.start();
  applyInputLock(true);
});

dom.pauseBtn.addEventListener("click", () => {
  state.timer.pause();
  applyInputLock(true);
});

dom.resetBtn.addEventListener("click", () => {
  ensureValidConfig();
  updateConfigFromInputs();
  state.timer.reset(getTotalSeconds("timer") * 1000, getTotalSeconds("interval") * 1000);
  applyInputLock(false);
  clearError();
});

// Keyboard shortcuts
// Space: start/pause, R: reset.
// Ignore when typing in inputs.
document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

  if (event.code === "Space") {
    event.preventDefault();
    if (state.timer.state === "running") {
      state.timer.pause();
      applyInputLock(true);
    } else {
      initAudio();
      ensureValidConfig();
      updateConfigFromInputs();
      state.timer.start();
      applyInputLock(true);
    }
  }

  if (event.key && event.key.toLowerCase() === "r") {
    if (state.timer.state === "running") return;
    ensureValidConfig();
    updateConfigFromInputs();
    state.timer.reset(getTotalSeconds("timer") * 1000, getTotalSeconds("interval") * 1000);
    applyInputLock(false);
  }

});

bindModeControls();
syncInputsWithConfig();
initTimerCore();
state.timer.reset(getTotalSeconds("timer") * 1000, getTotalSeconds("interval") * 1000);
