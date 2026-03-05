// Concert Companion App (Screenplay mode)
// - Audience selects Mood + Setting
// - Optional short note (comment)
// - Responses stored locally (prototype)
// - Visualization via Chart.js
// - Background glow changes based on selected mood
// - Safe handling if Chart.js fails to load
// - Resets selections after submit 

// ------------- Config Loading -------------
const CONFIG_KEY = "concertCustomConfig";
const DEFAULT_CONFIG_URL = "config.yaml";

let appConfig = {
  event: {
    artist: "Artist Name",
    location: "Location",
    participation: "Anonymous by default"
  },
  copy: {
    welcomeTitle: "Welcome, ",
    welcomeText: "Enjoy the show.",
    footerText: "Thank you for participating."
  },
  moods: [
    { name: "Happy", glow: "rgba(255, 230, 150, .25)" },
    { name: "Relaxed", glow: "rgba(150, 255, 220, .20)" },
    { name: "Melancholy", glow: "rgba(170, 160, 255, .22)" }
  ],
  colors: [
    { name: "Red", hex: "#ff0000" }, { name: "Vermilion", hex: "#ff4000" },
    { name: "Orange", hex: "#ff8000" }, { name: "Amber", hex: "#ffbf00" },
    { name: "Yellow", hex: "#ffff00" }, { name: "Chartreuse", hex: "#bfff00" },
    { name: "Green", hex: "#80ff00" }, { name: "Harlequin", hex: "#40ff00" },
    { name: "Lime", hex: "#00ff00" }, { name: "Erin", hex: "#00ff40" },
    { name: "Spring Green", hex: "#00ff80" }, { name: "Aquamarine", hex: "#00ffbf" },
    { name: "Cyan", hex: "#00ffff" }, { name: "Capri", hex: "#00bfff" },
    { name: "Azure", hex: "#0080ff" }, { name: "Cerulean", hex: "#0040ff" },
    { name: "Blue", hex: "#0000ff" }, { name: "Indigo", hex: "#4000ff" },
    { name: "Violet", hex: "#8000ff" }, { name: "Purple", hex: "#bf00ff" },
    { name: "Magenta", hex: "#ff00ff" }, { name: "Fuchsia", hex: "#ff00bf" },
    { name: "Rose", hex: "#ff0080" }, { name: "Crimson", hex: "#ff0040" },
    { name: "Dark Red", hex: "#cc0000" }, { name: "Tomato", hex: "#ff6347" },
    { name: "Gold", hex: "#ffd700" }, { name: "Forest", hex: "#228b22" },
    { name: "Teal", hex: "#008080" }, { name: "Navy", hex: "#000080" },
    { name: "Plum", hex: "#dda0dd" }, { name: "Pink", hex: "#ffc0cb" }
  ]
};

let MOODS = [];
let COLORS = [];
let MOOD_GLOWS = {};
const DEFAULT_GLOW = "rgba(139,220,255,.20)";

async function loadConfiguration() {
  let yamlText = null;
  const localConfigStr = localStorage.getItem(CONFIG_KEY);

  if (localConfigStr) {
    yamlText = localConfigStr;
  } else {
    try {
      const res = await fetch(DEFAULT_CONFIG_URL);
      if (res.ok) {
        yamlText = await res.text();
      }
    } catch (e) {
      console.warn("Could not fetch config.yaml", e);
    }
  }

  if (yamlText && typeof jsyaml !== 'undefined') {
    try {
      const parsed = jsyaml.load(yamlText);
      if (parsed.moods) {
        // Only merge properties that exist in the parsed user config
        appConfig = { ...appConfig, ...parsed };
      }
      if (!appConfig.colors) {
        // Provide fallback 32 colors if missing
        appConfig.colors = [
          { name: "Red", hex: "#ff0000" }, { name: "Vermilion", hex: "#ff4000" },
          { name: "Orange", hex: "#ff8000" }, { name: "Amber", hex: "#ffbf00" },
          { name: "Yellow", hex: "#ffff00" }, { name: "Chartreuse", hex: "#bfff00" },
          { name: "Green", hex: "#80ff00" }, { name: "Harlequin", hex: "#40ff00" },
          { name: "Lime", hex: "#00ff00" }, { name: "Erin", hex: "#00ff40" },
          { name: "Spring Green", hex: "#00ff80" }, { name: "Aquamarine", hex: "#00ffbf" },
          { name: "Cyan", hex: "#00ffff" }, { name: "Capri", hex: "#00bfff" },
          { name: "Azure", hex: "#0080ff" }, { name: "Cerulean", hex: "#0040ff" },
          { name: "Blue", hex: "#0000ff" }, { name: "Indigo", hex: "#4000ff" },
          { name: "Violet", hex: "#8000ff" }, { name: "Purple", hex: "#bf00ff" },
          { name: "Magenta", hex: "#ff00ff" }, { name: "Fuchsia", hex: "#ff00bf" },
          { name: "Rose", hex: "#ff0080" }, { name: "Crimson", hex: "#ff0040" },
          { name: "Dark Red", hex: "#cc0000" }, { name: "Tomato", hex: "#ff6347" },
          { name: "Gold", hex: "#ffd700" }, { name: "Forest", hex: "#228b22" },
          { name: "Teal", hex: "#008080" }, { name: "Navy", hex: "#000080" },
          { name: "Plum", hex: "#dda0dd" }, { name: "Pink", hex: "#ffc0cb" }
        ];
      }
    } catch (e) {
      console.error("Invalid YAML format", e);
    }
  }

  // Map structured config back to application arrays
  MOODS = appConfig.moods.map(m => m.name);
  COLORS = appConfig.colors || [];
  MOOD_GLOWS = {};
  appConfig.moods.forEach(m => {
    MOOD_GLOWS[m.name] = m.glow || DEFAULT_GLOW;
  });

  // Populate dynamic DOM strings
  if (appConfig.event) {
    const elArtist = document.getElementById("dynArtist");
    if (elArtist) elArtist.textContent = appConfig.event.artist;
    const elLoc = document.getElementById("dynLocation");
    if (elLoc) elLoc.textContent = appConfig.event.location;
    const elPart = document.getElementById("dynParticipation");
    if (elPart && appConfig.event.participation) {
      elPart.innerHTML = `<strong>Participation:</strong> ${appConfig.event.participation}`;
    }
  }
  if (appConfig.copy) {
    const elWelcomeTitle = document.getElementById("dynWelcomeTitle");
    if (elWelcomeTitle) elWelcomeTitle.textContent = appConfig.copy.welcomeTitle;
    const elWelcomeText = document.getElementById("dynWelcomeText");
    if (elWelcomeText) elWelcomeText.textContent = appConfig.copy.welcomeText;
    const elFooterText = document.getElementById("dynFooterText");
    if (elFooterText) elFooterText.textContent = appConfig.copy.footerText;
  }
}
// ------------- End Config -------------

// Storage keys (local prototype)
const EVENTS_KEY = "concertEvents";
const IDENTITY_KEY = "concertUser";

let currentUser = null;
let currentSessionId = "";

let selectedMood = "";
let selectedColor = "";

// IDs from your HTML
const moodButtonsWrap = document.getElementById("emotionButtons");
const moodSuccessOverlay = document.getElementById("moodSuccessOverlay");

const colorWheelWrap = document.getElementById("colorWheel");
const colorSuccessOverlay = document.getElementById("colorSuccessOverlay");

const commentEl = document.getElementById("comment");
const charHintEl = document.getElementById("charHint");
const successMsgEl = document.getElementById("successMsg");

const btnLike = document.getElementById("btnLike");
const btnDislike = document.getElementById("btnDislike");

const refreshBtn = document.getElementById("refreshCharts");
const exportBtn = document.getElementById("exportCSV");
const clearBtn = document.getElementById("clearLocal");
const exportMsgEl = document.getElementById("exportMsg");

// Identity elements
const identityModal = document.getElementById("identityModal");
const appShell = document.getElementById("appShell");
const idEmailInput = document.getElementById("idEmail");
const idNameInput = document.getElementById("idName");
const btnJoin = document.getElementById("btnJoin");
const idError = document.getElementById("idError");
const welcomeName = document.getElementById("welcomeName");
const currentUserEmail = document.getElementById("currentUserEmail");

let moodChart = null;
let settingChart = null;

// Friendly console warning if Chart.js doesn't load
if (typeof Chart === "undefined") {
  console.warn("Chart.js is not loaded. Charts will not render.");
}

function triggerSuccessAnimation(containerWrap, overlayEl) {
  if (!containerWrap || !overlayEl) return;

  // Fade out wheel
  containerWrap.classList.add("success-hide");
  // Show Checkmark
  overlayEl.classList.add("show");

  setTimeout(() => {
    // Hide check, restore wheel
    overlayEl.classList.remove("show");
    containerWrap.classList.remove("success-hide");

    // Clear active selections locally in the DOM since event was recorded
    const pills = containerWrap.querySelectorAll('.pill, .color-swatch');
    pills.forEach(p => p.classList.remove('active'));

    // Clear display label if color wheel
    if (containerWrap.id === "colorWheel") {
      const disp = document.getElementById("colorNameDisplay");
      if (disp) disp.textContent = "";
      selectedColor = "";
    }
  }, 1000);
}

// ---------- Helpers ----------
function createWheelPill(label, angleDeg, radiusPx) {
  const wrapper = document.createElement("div");
  wrapper.className = "wheel-item";
  wrapper.style.setProperty("--angle", `${angleDeg}deg`);
  wrapper.style.setProperty("--radius", `${radiusPx}px`);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pill";
  btn.textContent = label;

  btn.addEventListener("click", () => {
    selectedMood = label;
    setActivePill(moodButtonsWrap, label);
    document.documentElement.style.setProperty("--moodGlow", MOOD_GLOWS[label] || DEFAULT_GLOW);
    recordEvent("mood", label);
    triggerSuccessAnimation(moodButtonsWrap, moodSuccessOverlay);
  });

  wrapper.appendChild(btn);
  return wrapper;
}

function createColorSwatch(colorObj, angleDeg, radiusPx) {
  const wrapper = document.createElement("div");
  wrapper.className = "wheel-item";
  wrapper.style.setProperty("--angle", `${angleDeg}deg`);
  wrapper.style.setProperty("--radius", `${radiusPx}px`);

  const swatch = document.createElement("div");
  swatch.className = "color-swatch";
  swatch.style.backgroundColor = colorObj.hex;
  swatch.title = colorObj.name;

  swatch.addEventListener("mouseenter", () => {
    const disp = document.getElementById("colorNameDisplay");
    if (disp) disp.textContent = colorObj.name;
  });
  swatch.addEventListener("mouseleave", () => {
    const disp = document.getElementById("colorNameDisplay");
    if (disp) disp.textContent = selectedColor || "";
  });

  swatch.addEventListener("click", () => {
    selectedColor = colorObj.name;
    const disp = document.getElementById("colorNameDisplay");
    if (disp) disp.textContent = colorObj.name;
    const allSwatches = colorWheelWrap.querySelectorAll('.color-swatch');
    allSwatches.forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');

    // Optional: make mood glow match color
    // document.documentElement.style.setProperty("--moodGlow", colorObj.hex + "33"); 
    recordEvent("color", colorObj.name);
    triggerSuccessAnimation(colorWheelWrap, colorSuccessOverlay);
  });

  wrapper.appendChild(swatch);
  return wrapper;
}

function setActivePill(container, label) {
  const pills = container.querySelectorAll(".pill");
  pills.forEach(p => p.classList.remove("active"));
  if (!label) return;

  const active = Array.from(pills).find(p => p.textContent === label);
  if (active) active.classList.add("active");
}

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function getEvents() {
  return loadJSON(EVENTS_KEY, []);
}

function saveEventToDatabase(eventData) {
  const events = getEvents();
  events.push(eventData);
  saveJSON(EVENTS_KEY, events);
  console.log("Saved event to local db:", eventData);
}

function recordEvent(category, value) {
  if (!currentUser) return; // Prevent saving if not identified

  const eventData = {
    id: crypto?.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    sessionId: currentSessionId,
    userId: currentUser.email,
    userName: currentUser.name,
    mockIp: currentUser.mockIp,
    timestamp: new Date().toISOString(),
    category: category,
    value: value
  };
  saveEventToDatabase(eventData);
  renderCharts();
}

// ---------- Identity Logic ----------
function checkIdentity() {
  const savedUser = loadJSON(IDENTITY_KEY, null);
  if (savedUser && savedUser.email) {
    currentUser = savedUser;
    startSession();
  } else {
    identityModal.style.display = "flex";
  }
}

function generateMockIp() {
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)).join('.');
}

btnJoin.addEventListener("click", () => {
  idError.textContent = "";
  const email = idEmailInput.value.trim();
  const name = idNameInput.value.trim() || "Participant";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    idError.textContent = "Please provide a valid email address.";
    return;
  }

  // Check if existed, else generate mock IP
  let mockIp = generateMockIp();
  const existingEvents = getEvents().find(e => e.userId === email);
  if (existingEvents) {
    mockIp = existingEvents.mockIp || mockIp;
  }

  currentUser = { email, name, mockIp };
  saveJSON(IDENTITY_KEY, currentUser);
  startSession();
});

function startSession() {
  identityModal.style.display = "none";
  appShell.style.display = "block";
  welcomeName.textContent = currentUser.name;
  currentUserEmail.textContent = currentUser.email;

  // Generate a distinct session ID for this browser tab instance
  currentSessionId = crypto?.randomUUID ? crypto.randomUUID() : `sess_${Math.random().toString(16).slice(2)}`;

  // Render App based on config
  renderButtons();
  renderCharts();
  document.documentElement.style.setProperty("--moodGlow", DEFAULT_GLOW);
}

function setMessage(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

// ---------- Render buttons ----------
function renderButtons() {
  if (moodButtonsWrap) moodButtonsWrap.innerHTML = "";
  if (colorWheelWrap) colorWheelWrap.innerHTML = '<div id="colorNameDisplay" class="selected-color-name"></div>';

  // Render Mood Wheel
  if (moodButtonsWrap && MOODS.length > 0) {
    const moodRadius = 65;
    const moodStep = 360 / MOODS.length;
    MOODS.forEach((m, idx) => {
      moodButtonsWrap.appendChild(createWheelPill(m, idx * moodStep - 90, moodRadius));
    });
  }

  // Render Color Wheel
  if (colorWheelWrap && COLORS.length > 0) {
    const colorRadius = 75;
    const colorStep = 360 / COLORS.length;
    COLORS.forEach((c, idx) => {
      colorWheelWrap.appendChild(createColorSwatch(c, idx * colorStep - 90, colorRadius));
    });
  }
}

// ---------- Like / Dislike ----------
if (btnLike && btnDislike) {
  btnLike.addEventListener("click", () => {
    recordEvent("reaction", "like");
    btnLike.classList.add("active");
    btnDislike.classList.remove("active");
    setTimeout(() => btnLike.classList.remove("active"), 3000);
  });

  btnDislike.addEventListener("click", () => {
    recordEvent("reaction", "dislike");
    btnDislike.classList.add("active");
    btnLike.classList.remove("active");
    setTimeout(() => btnDislike.classList.remove("active"), 3000);
  });
}

// ---------- Note auto-save ----------
commentEl.addEventListener("change", () => {
  const note = commentEl.value.trim();
  if (note) {
    recordEvent("note", note);
    setMessage(successMsgEl, "Note saved.", false);
    setTimeout(() => setMessage(successMsgEl, "", false), 3000);
  }
});

// ---------- Character counter ----------
commentEl.addEventListener("input", () => {
  const len = commentEl.value.length;
  charHintEl.textContent = `${len} / 140`;
});

// ---------- Charts (Historical Line) ----------
// aggregate data by minute: { "label": { "2026-03-05T10:15": count } }
function aggregateTimelineEvents(data, category, labels) {
  const timeseries = {};
  labels.forEach(l => timeseries[l] = {});

  // To ensure the chart looks cohesive, track all unique minute stamps seen
  const allMinutes = new Set();

  data.forEach(item => {
    if (item.category === category) {
      if (labels.includes(item.value)) {
        // truncate ISO string to YYYY-MM-DDTHH:MM to bucket by minute
        const minuteKey = item.timestamp.substring(0, 16);
        allMinutes.add(minuteKey);
        timeseries[item.value][minuteKey] = (timeseries[item.value][minuteKey] || 0) + 1;
      }
    }
  });

  const sortedMinutes = Array.from(allMinutes).sort();
  return { timeseries, sortedMinutes };
}

function renderCharts() {
  if (typeof Chart === "undefined") {
    setMessage(exportMsgEl, "Charts unavailable (Chart.js did not load).", true);
    return;
  }

  const events = getEvents();

  const moodData = aggregateTimelineEvents(events, "mood", MOODS);

  const formatLabels = (minutes) => minutes.map(m => m.split('T')[1]); // Just show HH:MM

  const moodLabels = formatLabels(moodData.sortedMinutes);
  const moodDatasets = MOODS.map(mood => {
    return {
      label: mood,
      data: moodData.sortedMinutes.map(minute => moodData.timeseries[mood][minute] || 0),
      borderColor: MOOD_GLOWS[mood] || "#ffffff",
      tension: 0.3,
      fill: false
    };
  });

  const moodCanvas = document.getElementById("emotionChart");
  if (!moodCanvas) return;

  const moodCtx = moodCanvas.getContext("2d");

  if (moodChart) moodChart.destroy();

  moodChart = new Chart(moodCtx, {
    type: "line",
    data: {
      labels: moodLabels.length ? moodLabels : ["No Data"],
      datasets: moodDatasets.some(ds => ds.data.some(d => d > 0)) ? moodDatasets : []
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { color: '#c7c9ce', font: { size: 10 } } } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0, color: '#c7c9ce' } },
        x: { ticks: { color: '#c7c9ce' } }
      }
    }
  });
}

refreshBtn.addEventListener("click", renderCharts);

// ---------- Export CSV ----------
function toCSV(rows) {
  if (!rows.length) return "";

  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = [
    headers.join(","),
    ...rows.map(r => headers.map(h => escape(r[h])).join(","))
  ];

  return lines.join("\n");
}

exportBtn.addEventListener("click", () => {
  setMessage(exportMsgEl, "", false);

  const events = getEvents();
  if (!events.length) {
    setMessage(exportMsgEl, "No events to export yet.", true);
    return;
  }

  const csv = toCSV(events);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "concert_script_responses.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);

  setMessage(exportMsgEl, "Exported CSV.", false);
});

// ---------- Clear local data ----------
clearBtn.addEventListener("click", () => {
  const ok = confirm("Clear all local events and logout?");
  if (!ok) return;

  localStorage.removeItem(EVENTS_KEY);
  localStorage.removeItem(IDENTITY_KEY);
  currentUser = null;

  setMessage(exportMsgEl, "Local data cleared.", false);
  identityModal.style.display = "flex";
  appShell.style.display = "none";
  idEmailInput.value = "";
});

// ---------- Init ----------
async function initializeApp() {
  await loadConfiguration();
  checkIdentity();
}

initializeApp();