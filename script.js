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

  // Safely populate any dynamic DOM strings if they still exist
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

const colorCloseBtn = document.getElementById("colorCloseBtn");
const moodCloseBtn = document.getElementById("moodCloseBtn");
const colorCardBody = document.getElementById("colorCardBody");
const grayscaleSwatches = document.getElementById("grayscaleSwatches");
const moodCardBody = document.getElementById("moodCardBody");

if (colorCloseBtn) {
  colorCloseBtn.addEventListener("click", () => {
    if (currentSelections.color) {
      document.querySelectorAll(".color-wedge, .grayscale-swatch").forEach(p => {
        p.classList.remove("active");
        if (p.classList.contains("color-wedge")) {
          p.style.stroke = "rgba(255, 255, 255, 0.15)";
          p.style.strokeWidth = "1";
        } else {
          p.style.transform = "scale(1)";
          p.style.boxShadow = "none";
        }
      });
      const colorSuccessOverlay = document.getElementById("colorSuccessOverlay");
      if (colorSuccessOverlay) colorSuccessOverlay.classList.remove("show");

      handleSelection("color", currentSelections.color); // toggle clears it
    }
  });
}
if (moodCloseBtn) {
  moodCloseBtn.addEventListener("click", () => {
    if (currentSelections.mood) {
      document.querySelectorAll(".mood-wedge").forEach(p => {
        p.classList.remove("active");
        if (currentSelections.colorHex) {
          const rawColor = currentSelections.colorHex;
          if (rawColor.startsWith('#')) {
            const r = parseInt(rawColor.slice(1, 3), 16);
            const g = parseInt(rawColor.slice(3, 5), 16);
            const b = parseInt(rawColor.slice(5, 7), 16);
            p.style.fill = `rgba(${r}, ${g}, ${b}, 0.3)`;
          } else if (rawColor.startsWith('hsl')) {
            p.style.fill = rawColor.replace('hsl', 'hsla').replace(')', ', 0.3)');
          } else {
            p.style.fill = "rgba(255, 255, 255, 0.08)";
          }
        } else {
          p.style.fill = "rgba(255, 255, 255, 0.08)";
        }
      });
      const moodSuccessOverlay = document.getElementById("moodSuccessOverlay");
      if (moodSuccessOverlay) moodSuccessOverlay.classList.remove("show");

      document.documentElement.style.setProperty("--moodGlow", currentSelections.colorHex || "rgba(255, 255, 255, 0.2)");
      handleSelection("mood", currentSelections.mood); // toggle clears it
    }
  });
}

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

const reactionButtonsWrap = document.getElementById("reactionButtonsWrap");
const mainReactionButtonGroup = document.getElementById("mainReactionButtonGroup");
const reactionSuccessOverlay = document.getElementById("reactionSuccessOverlay");
const btnMeh = document.getElementById("btnMeh");

const continuousCommentEl = document.getElementById("continuousComment");
const continuousCharHintEl = document.getElementById("continuousCharHint");
const btnSubmitContinuousNote = document.getElementById("btnSubmitContinuousNote");
const noteSuccessOverlay = document.getElementById("noteSuccessOverlay");
const noteCardBody = document.getElementById("noteCardBody");

document.querySelectorAll(".grayscale-swatch").forEach(swatch => {
  swatch.addEventListener("click", () => {
    const isActive = swatch.classList.contains("active");

    const allPaths = document.querySelectorAll(".color-wedge, .grayscale-swatch");
    allPaths.forEach(p => {
      p.classList.remove("active");
      if (p.classList.contains("color-wedge")) {
        p.style.stroke = "rgba(255, 255, 255, 0.15)";
        p.style.strokeWidth = "1";
      } else {
        p.style.transform = "scale(1)";
        p.style.boxShadow = "none";
      }
    });

    const disp = document.getElementById("colorNameDisplay");

    if (isActive) {
      selectedColor = null;
      updateColorDisplay(disp, "", ""); // clear if unselected
    } else {
      swatch.classList.add("active");
      swatch.style.transform = "scale(1.15)";
      swatch.style.boxShadow = "0 0 10px #fff";

      selectedColor = swatch.dataset.colorName;
      updateColorDisplay(disp, "", "");
    }

    recordEvent("color", swatch.dataset.colorName, { colorRgba: swatch.dataset.color });
    handleSelection("color", swatch.dataset.colorName, swatch.dataset.color);
  });
});
const btnLike = document.getElementById("btnLike");
const btnApplause = document.getElementById("btnApplause");

const trackBanner = document.getElementById("trackBanner");
const currentTrackTitle = document.getElementById("currentTrackTitle");
const trackPopupOverlay = document.createElement("div");

// Setup track popup overlay
trackPopupOverlay.style.position = "fixed";
trackPopupOverlay.style.top = "0";
trackPopupOverlay.style.left = "0";
trackPopupOverlay.style.width = "100%";
trackPopupOverlay.style.height = "100%";
trackPopupOverlay.style.backgroundColor = "rgba(0,0,0,0.85)";
trackPopupOverlay.style.display = "none";
trackPopupOverlay.style.alignItems = "center";
trackPopupOverlay.style.justifyContent = "center";
trackPopupOverlay.style.flexDirection = "column";
trackPopupOverlay.style.zIndex = "9999";
trackPopupOverlay.style.color = "white";
trackPopupOverlay.innerHTML = `<h2 style="font-size: 2rem; margin-bottom: 10px;">Now Playing</h2><h1 id="popupTrackTitle" style="font-size: 3rem; text-align: center; color: var(--primary);"></h1>`;
document.body.appendChild(trackPopupOverlay);

const wordCloudModal = document.getElementById("wordCloudModal");
const btnCloseWordCloud = document.getElementById("btnCloseWordCloud");
const btnSkipWordCloud = document.getElementById("btnSkipWordCloud");

const strengthModal = document.getElementById("strengthModal");
const btnCloseStrength = document.getElementById("btnCloseStrength");
const popupReactionButtonsWrap = document.getElementById("popupReactionButtonsWrap");
const popupReactionButtonGroup = document.getElementById("popupReactionButtonGroup");
const popupSuccessOverlay = document.getElementById("popupSuccessOverlay");
const btnPopupMeh = document.getElementById("btnPopupMeh");
const btnPopupLike = document.getElementById("btnPopupLike");
const btnPopupApplause = document.getElementById("btnPopupApplause");

let sseSource = null;

// Identity elements
const lobbyAuthForm = document.getElementById("lobbyAuthForm");
const lobbyWaitGroup = document.getElementById("lobbyWaitGroup");
const preShowLobby = document.getElementById("preShowLobby");
const appShell = document.getElementById("appShell");
const idEmailInput = document.getElementById("idEmail");
const idNameInput = document.getElementById("idName");
const idConsentInput = document.getElementById("idConsent");
const btnJoin = document.getElementById("btnJoin");
const idError = document.getElementById("idError");
const welcomeName = document.getElementById("welcomeName");
const btnSwitchUser = document.getElementById("btnSwitchUser");
// Current track info
let currentTrack = null;

// Friendly console warning if Chart.js doesn't load
if (typeof Chart === "undefined") {
  console.warn("Chart.js is not loaded. Charts will not render.");
}

let currentSelections = { color: null, mood: null, reaction: null };
let masterTimeout = null;
let inactivityTimer = null;

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  // Do not reset inactivity if a success overlap is visible
  if (masterTimeout) return;
  inactivityTimer = setTimeout(() => {
    // If not complete after 10 seconds, auto submit
    if (!currentSelections.color || !currentSelections.mood || !currentSelections.reaction) {
      submitSelections(true);
    }
  }, 10000);
}

function submitSelections(isAutoSubmit = false) {
  let reactionVal = 1; // meh
  if (currentSelections.reaction === 'like') reactionVal = 2;
  if (currentSelections.reaction === 'applause') reactionVal = 4;
  if (isAutoSubmit && !currentSelections.reaction) reactionVal = 0; // null value for auto-submit

  recordEvent("combined_reaction", reactionVal, {
    colorName: currentSelections.color ? currentSelections.color.replace('Light ', '') : "None",
    mood: currentSelections.mood || "None",
    colorRgba: currentSelections.colorHex || "transparent",
    reactionLabel: currentSelections.reaction || "None"
  });

  // Lock out resetting once submitted
  const colorCloseBtn = document.getElementById("colorCloseBtn");
  const moodCloseBtn = document.getElementById("moodCloseBtn");
  if (colorCloseBtn) colorCloseBtn.style.display = "none";
  if (moodCloseBtn) moodCloseBtn.style.display = "none";

  clearTimeout(masterTimeout);
  clearTimeout(inactivityTimer);
  // Auto-submissions reset faster (1.5s vs 5s) because user isn't actively looking at the success screen
  masterTimeout = setTimeout(resetAllSelections, isAutoSubmit ? 1500 : 5000);
}

function getCombinedText() {
  let parts = [];
  if (currentSelections.color) parts.push(currentSelections.color.replace(' (Soft)', ''));
  if (currentSelections.mood) parts.push(currentSelections.mood);
  let text = parts.join(" ");
  if (currentSelections.reaction) {
    let emoji = "";
    if (currentSelections.reaction === "meh") emoji = "😐";
    if (currentSelections.reaction === "like") emoji = "👍";
    if (currentSelections.reaction === "applause") emoji = "👏";
    text += " " + emoji;
  }
  return text || "✓";
}

function updateOverlays() {
  const text = getCombinedText();
  const fontSize = text.length > 5 ? "1.6rem" : "3rem";

  const cOverlay = document.getElementById("colorSuccessOverlay");
  const mOverlay = document.getElementById("moodSuccessOverlay");
  const rOverlay = document.getElementById("reactionSuccessOverlay");
  const pOverlay = document.getElementById("popupSuccessOverlay");

  [cOverlay, mOverlay, rOverlay, pOverlay].forEach(ov => {
    if (ov) {
      ov.textContent = text;
      ov.style.fontSize = fontSize;
      ov.style.textAlign = "center";
      ov.style.width = "100%";
    }
  });
}

function resetAllSelections() {
  const cc = document.getElementById("colorCard");
  if (cc) { cc.style.backgroundColor = ""; cc.style.color = ""; cc.querySelectorAll("h2, p, .hint").forEach(el => el.style.color = ""); }

  const mc = document.getElementById("moodCard");
  if (mc) { mc.style.backgroundColor = ""; mc.style.color = ""; mc.querySelectorAll("h2, p, .hint").forEach(el => el.style.color = ""); }

  const rc = document.getElementById("reactionCard");
  if (rc) { rc.style.backgroundColor = ""; rc.style.color = ""; rc.querySelectorAll("h2, p, .hint").forEach(el => el.style.color = ""); }

  if (colorWheelWrap) {
    const svg = colorWheelWrap.querySelector('svg');
    if (svg) { svg.style.opacity = "1"; svg.style.pointerEvents = "auto"; }
  }
  if (moodButtonsWrap) {
    const svg = moodButtonsWrap.querySelector('svg');
    if (svg) { svg.style.opacity = "1"; svg.style.pointerEvents = "auto"; }
  }
  if (mainReactionButtonGroup) {
    mainReactionButtonGroup.style.opacity = "1";
    mainReactionButtonGroup.style.pointerEvents = "auto";
  }
  if (popupReactionButtonGroup) {
    popupReactionButtonGroup.style.opacity = "1";
    popupReactionButtonGroup.style.pointerEvents = "auto";
  }

  const cOverlay = document.getElementById("colorSuccessOverlay");
  const mOverlay = document.getElementById("moodSuccessOverlay");
  const rOverlay = document.getElementById("reactionSuccessOverlay");
  const pOverlay = document.getElementById("popupSuccessOverlay");

  if (cOverlay) cOverlay.classList.remove("show");
  if (mOverlay) mOverlay.classList.remove("show");
  if (rOverlay) rOverlay.classList.remove("show");
  if (pOverlay) pOverlay.classList.remove("show");

  document.querySelectorAll(".mood-wedge, .color-wedge").forEach(p => {
    p.classList.remove('active');
    if (p.classList.contains('mood-wedge')) {
      p.style.fill = "rgba(255, 255, 255, 0.08)";
    }
    if (p.classList.contains('color-wedge')) {
      p.style.stroke = "rgba(255, 255, 255, 0.15)";
      p.style.strokeWidth = "1";
    }
  });

  document.querySelectorAll('.grayscale-swatch').forEach(p => {
    p.classList.remove('active');
    p.style.transform = "scale(1)";
    p.style.boxShadow = "none";
  });

  const cards = ["colorCard", "moodCard", "reactionCard"];
  cards.forEach(id => {
    const card = document.getElementById(id);
    if (card) {
      card.style.backgroundColor = "";
      card.style.color = "";
      card.querySelectorAll("h2, p, .hint").forEach(el => el.style.color = "");
      card.style.height = "";
      card.style.padding = "";
    }
  });

  if (colorCloseBtn) colorCloseBtn.style.display = "none";
  if (colorCardBody) colorCardBody.style.opacity = "1";
  if (grayscaleSwatches) grayscaleSwatches.style.display = "flex";
  const hintC = document.getElementById("colorHint");
  if (hintC) hintC.style.display = "block";

  if (moodCloseBtn) moodCloseBtn.style.display = "none";
  if (moodCardBody) moodCardBody.style.opacity = "1";
  const hintM = document.getElementById("moodHint");
  if (hintM) hintM.style.display = "block";

  const disp = document.getElementById("colorNameDisplay");
  if (disp) { disp.textContent = ""; disp.style.backgroundColor = "transparent"; disp.style.opacity = "0"; }

  currentSelections = { color: null, mood: null, reaction: null };
  updateOverlays();
}

function handleSelection(type, name, hexColorOrGlow) {
  // Deselect if clicking the same item
  if (currentSelections[type] === name) {
    currentSelections[type] = null;
    if (type === 'color') currentSelections.colorHex = null;

    // Reset specific card UI
    const card = document.getElementById(`${type}Card`);
    if (card) {
      card.style.backgroundColor = "";
      card.style.color = "";
      card.querySelectorAll("h2, p, .hint").forEach(el => el.style.color = "");
      card.style.height = "";
      card.style.padding = "";

      const h2 = document.getElementById(`${type}Heading`);
      if (h2) {
        if (type === 'color') h2.textContent = "1) What color does this feel like?";
        if (type === 'mood') h2.textContent = "2) How does this make you feel right now?";
        if (type === 'reaction') h2.textContent = "3) How do you respond?";
      }
    }

    if (type === 'color') {
      if (colorCloseBtn) colorCloseBtn.style.display = "none";
      if (colorCardBody) colorCardBody.style.opacity = "1";
      if (grayscaleSwatches) grayscaleSwatches.style.display = "flex";
      const hint = document.getElementById("colorHint");
      if (hint) hint.style.display = "block";
      if (colorWheelWrap) {
        const svg = colorWheelWrap.querySelector('svg');
        if (svg) { svg.style.opacity = "1"; svg.style.pointerEvents = "auto"; }
      }
    }

    if (type === 'mood') {
      if (moodCloseBtn) moodCloseBtn.style.display = "none";
      if (moodCardBody) moodCardBody.style.opacity = "1";
      const hint = document.getElementById("moodHint");
      if (hint) hint.style.display = "block";
      if (moodButtonsWrap) {
        const svg = moodButtonsWrap.querySelector('svg');
        if (svg) { svg.style.opacity = "1"; svg.style.pointerEvents = "auto"; }
      }
    }

    // Clear dynamic sub-coloring for moods if color is deselected
    if (type === 'color') {
      const moodColor = "rgba(255, 255, 255, 0.08)";
      document.querySelectorAll(".mood-wedge").forEach(p => {
        if (!p.classList.contains("active")) {
          p.style.fill = moodColor;
        } else {
          p.style.fill = "rgba(255, 255, 255, 0.35)"; // fallback active
        }
      });
    }

    updateOverlays();
    return; // Exit early since we just deselected
  }

  currentSelections[type] = name;
  if (type === 'color') currentSelections.colorHex = hexColorOrGlow;
  updateOverlays();

  if (type === 'color') {
    const card = document.getElementById("colorCard");
    card.style.backgroundColor = hexColorOrGlow;
    const contrast = getContrastYIQ(hexColorOrGlow);
    card.style.color = contrast;
    card.querySelectorAll("h2, p, .hint").forEach(el => el.style.color = contrast);

    const h2 = document.getElementById("colorHeading");
    if (h2) h2.textContent = name;

    // Collapse card
    card.style.height = "100px";
    card.style.padding = "20px";
    if (colorCloseBtn) { colorCloseBtn.style.display = "block"; colorCloseBtn.style.color = contrast; }
    if (colorCardBody) colorCardBody.style.opacity = "0";
    if (grayscaleSwatches) grayscaleSwatches.style.display = "none";
    const hint = document.getElementById("colorHint");
    if (hint) hint.style.display = "none";

    // Sync mood wheels to the raw color if available
    const rawColor = hexColorOrGlow.includes('hsl') || hexColorOrGlow.includes('#') ? hexColorOrGlow : "rgba(255, 255, 255, 0.08)";
    let rgbFill = rawColor;

    // If it's a hex, we can fade it slightly for inactive mood wedges
    if (rawColor.startsWith('#')) {
      // simple opacity wrap
      const r = parseInt(rawColor.slice(1, 3), 16);
      const g = parseInt(rawColor.slice(3, 5), 16);
      const b = parseInt(rawColor.slice(5, 7), 16);
      rgbFill = `rgba(${r}, ${g}, ${b}, 0.3)`;
    } else if (rawColor.startsWith('hsl')) {
      rgbFill = rawColor.replace('hsl', 'hsla').replace(')', ', 0.3)');
    }

    document.querySelectorAll(".mood-wedge").forEach(p => {
      if (!p.classList.contains("active")) {
        p.style.fill = rgbFill;
      } else {
        // boost the active one
        p.style.fill = rgbFill.replace(/0\.3\)$/, '0.8)');
      }
    });

    if (colorWheelWrap) {
      const svg = colorWheelWrap.querySelector('svg');
      if (svg) { svg.style.opacity = "0"; svg.style.pointerEvents = "none"; }
    }
    const colorSuccessOverlay = document.getElementById("colorSuccessOverlay");
    colorSuccessOverlay.classList.add("show");
    colorSuccessOverlay.style.color = contrast;
  }
  else if (type === 'mood') {
    const card = document.getElementById("moodCard");
    const solidGlow = (hexColorOrGlow || "rgba(255,255,255,0.7)").replace(/[^,]+(?=\))/, '0.7');
    card.style.backgroundColor = solidGlow;

    // Determine contrast from the raw hex if available, or just give something that works with 0.7 opacity
    const contrast = currentSelections.colorHex ? getContrastYIQ(currentSelections.colorHex) : "#fff";
    card.style.color = contrast;
    card.querySelectorAll("h2, p, .hint").forEach(el => el.style.color = contrast);

    const h2 = document.getElementById("moodHeading");
    if (h2) h2.textContent = name;

    // Collapse card
    card.style.height = "100px";
    card.style.padding = "20px";
    if (moodCloseBtn) { moodCloseBtn.style.display = "block"; moodCloseBtn.style.color = contrast; }
    if (moodCardBody) moodCardBody.style.opacity = "0";
    const hint = document.getElementById("moodHint");
    if (hint) hint.style.display = "none";

    if (moodButtonsWrap) {
      const svg = moodButtonsWrap.querySelector('svg');
      if (svg) { svg.style.opacity = "0"; svg.style.pointerEvents = "none"; }
    }
    const moodSuccessOverlay = document.getElementById("moodSuccessOverlay");
    moodSuccessOverlay.classList.add("show");
    moodSuccessOverlay.style.color = contrast;
  } else if (type === 'reaction') {
    const card = document.getElementById("reactionCard");
    // Just a slight highlight for the card since we don't have a specific color
    card.style.backgroundColor = "rgba(255,255,255,0.15)";

    // Collapse card
    card.style.height = "100px";
    card.style.padding = "20px";

    if (mainReactionButtonGroup) {
      mainReactionButtonGroup.style.opacity = "0";
      mainReactionButtonGroup.style.pointerEvents = "none";
    }
    const reactionSuccessOverlay = document.getElementById("reactionSuccessOverlay");
    reactionSuccessOverlay.classList.add("show");

    if (popupReactionButtonGroup) {
      popupReactionButtonGroup.style.opacity = "0";
      popupReactionButtonGroup.style.pointerEvents = "none";
    }
    const popupSuccessOverlay = document.getElementById("popupSuccessOverlay");
    if (popupSuccessOverlay) popupSuccessOverlay.classList.add("show");
  }

  if (currentSelections.color && currentSelections.mood && currentSelections.reaction) {
    submitSelections(false);
  } else {
    resetInactivityTimer();
  }
}


// ---------- Helpers ----------
function hexToHSL(H) {
  let r = 0, g = 0, b = 0;
  if (H.length == 4) {
    r = "0x" + H[1] + H[1];
    g = "0x" + H[2] + H[2];
    b = "0x" + H[3] + H[3];
  } else if (H.length == 7) {
    r = "0x" + H[1] + H[2];
    g = "0x" + H[3] + H[4];
    b = "0x" + H[5] + H[6];
  }
  r /= 255; g /= 255; b /= 255;
  let cmin = Math.min(r, g, b),
    cmax = Math.max(r, g, b),
    delta = cmax - cmin,
    h = 0, s = 0, l = 0;

  if (delta == 0) h = 0;
  else if (cmax == r) h = ((g - b) / delta) % 6;
  else if (cmax == g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  h = Math.round(h * 60);
  if (h < 0) h += 360;
  l = (cmax + cmin) / 2;
  s = delta == 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  s = +(s * 100).toFixed(1);
  l = +(l * 100).toFixed(1);
  return { h, s, l };
}

function loadJSON(key, fallback) {
  try {
    const val = JSON.parse(localStorage.getItem(key));
    return val !== null ? val : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

async function recordEvent(category, value, extraProps = {}) {
  if (!currentUser) return;

  const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
  const eventData = {
    id: hasCrypto ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    sessionId: currentSessionId,
    userId: currentUser.email,
    userName: currentUser.name,
    mockIp: currentUser.mockIp,
    timestamp: new Date().toISOString(),
    category: category,
    value: value,
    ...extraProps
  };

  try {
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData)
    });
    if (!res.ok) console.error("Failed to save event");
  } catch (err) {
    console.error("Network error saving event", err);
  }
}

// ---------- Identity Logic ----------
function checkIdentity() {
  const savedUser = loadJSON(IDENTITY_KEY, null);
  if (savedUser && savedUser.email) {
    currentUser = savedUser;
    startSession();
  } else {
    if (preShowLobby) preShowLobby.style.display = "flex";
    if (lobbyAuthForm) lobbyAuthForm.style.display = "block";
    if (lobbyWaitGroup) lobbyWaitGroup.style.display = "none";
  }
}

function generateMockIp() {
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)).join('.');
}

btnJoin.addEventListener("click", async () => {
  idError.textContent = "";
  const email = idEmailInput.value.trim();
  const name = idNameInput.value.trim() || "Participant";
  const emailConsent = idConsentInput ? idConsentInput.checked : false;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    idError.textContent = "Please provide a valid email address.";
    return;
  }

  // Check if existed, else generate mock IP
  let mockIp = generateMockIp();
  let existingUserEvents = [];
  try {
    const res = await fetch('/api/events');
    if (res.ok) {
      const events = await res.json();
      existingUserEvents = events.filter(e => e.userId === email);
    }
  } catch (e) { }

  if (existingUserEvents.length > 0) {
    mockIp = existingUserEvents[0].mockIp || mockIp;
  }

  currentUser = { email, name, mockIp, emailConsent };
  saveJSON(IDENTITY_KEY, currentUser);

  // Register user profile to server
  try {
    await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentUser)
    });
  } catch (e) {
    console.error("Failed to register user to server");
  }

  startSession();
});

function startSession() {
  if (lobbyAuthForm) lobbyAuthForm.style.display = "none";
  if (lobbyWaitGroup) lobbyWaitGroup.style.display = "block";
  if (welcomeName) welcomeName.textContent = currentUser.name;

  // Generate a distinct session ID for this browser tab instance
  const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
  currentSessionId = hasCrypto ? crypto.randomUUID() : `sess_${Math.random().toString(16).slice(2)}`;

  // Render App based on config
  renderButtons();
  document.documentElement.style.setProperty("--moodGlow", DEFAULT_GLOW);

  // Connect to SSE stream
  connectStream();

  // Fetch initial show state to display the correct top-level container
  fetch('/api/state')
    .then(r => r.json())
    .then(data => {
      applyShowState(data.showState);
    })
    .catch(() => {
      applyShowState('ACTIVE'); // fallback
    });
}

function applyShowState(state) {
  const preShow = document.getElementById("preShowLobby");
  const appShell = document.getElementById("appShell");
  const postShow = document.getElementById("postShowRecap");
  
  if (preShow) preShow.style.display = "none";
  if (appShell) appShell.style.display = "none";
  if (postShow) postShow.style.display = "none";

  if (state === "PRE_SHOW") {
    if (preShow) preShow.style.display = "flex";
  } else if (state === "ACTIVE") {
    if (appShell) appShell.style.display = "block";
  } else if (state === "POST_SHOW") {
    if (postShow) postShow.style.display = "flex";
    generateRecap();
  }
}

async function generateRecap() {
  const recapEl = document.getElementById("recapContent");
  if (!recapEl || !currentUser) return;
  
  try {
    const res = await fetch('/api/events');
    const allEvents = await res.json();
    const myEvents = allEvents.filter(e => e.userId === currentUser.email);
    
    // Ignore system events
    const myUserEvents = myEvents.filter(e => e.category !== 'system');
    const allUserEvents = allEvents.filter(e => e.category !== 'system');

    const colors = myUserEvents.filter(e => e.category === 'color').length;
    const moods = myUserEvents.filter(e => e.category === 'mood').length;
    const notes = myUserEvents.filter(e => e.category === 'note').length;
    const total = myUserEvents.length;
    
    recapEl.innerHTML = `
      <p>You contributed <strong style="color: var(--primary); font-size: 1.3em;">${total}</strong> interactions tonight.</p>
      <ul style="list-style: none; padding: 0; margin-top: 20px; color: var(--text-muted); text-align: left; display: inline-block;">
        <li style="margin-bottom: 8px;">🎨 Colors picked: <strong style="color: #fff;">${colors}</strong></li>
        <li style="margin-bottom: 8px;">🎭 Moods felt: <strong style="color: #fff;">${moods}</strong></li>
        <li style="margin-bottom: 8px;">📝 Notes sent: <strong style="color: #fff;">${notes}</strong></li>
      </ul>
      <p style="margin-top: 20px; font-size: 0.9em; opacity: 0.8;">Compared to the <strong style="color: #fff;">${allUserEvents.length}</strong> total interactions from the entire audience.</p>
    `;
  } catch (err) {
    recapEl.innerHTML = "Unable to fetch recap data.";
  }
}

if (btnSwitchUser) {
  btnSwitchUser.addEventListener("click", () => {
    localStorage.removeItem(IDENTITY_KEY);
    currentUser = null;
    if (appShell) appShell.style.display = "none";
    const postShow = document.getElementById("postShowRecap");
    if (postShow) postShow.style.display = "none";
    
    if (preShowLobby) preShowLobby.style.display = "flex";
    if (lobbyAuthForm) lobbyAuthForm.style.display = "block";
    if (lobbyWaitGroup) lobbyWaitGroup.style.display = "none";
    idEmailInput.value = "";
    idNameInput.value = "";
  });
}

function connectStream() {
  if (sseSource) return;
  sseSource = new EventSource('/api/stream');
  sseSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);

      if (data.type === 'state_change') {
        applyShowState(data.showState);
      }

      // Handle legacy 'track' event for backwards compatibility with existing clients/connections
      if (data.type === 'track') {
        currentTrack = data.track;
        if (currentTrack) {
          trackBanner.style.display = "block";
          currentTrackTitle.textContent = currentTrack.title;
        } else {
          trackBanner.style.display = "none";
        }
      }

      if (data.type === 'track_start') {
        const oldTrackId = currentTrack ? currentTrack.id : null;
        currentTrack = data.track;

        if (currentTrack) {
          trackBanner.style.display = "block";
          currentTrackTitle.textContent = currentTrack.title;

          // If this is actually a new track starting, show the big popup for 5 seconds
          if (oldTrackId !== currentTrack.id) {
            document.getElementById("popupTrackTitle").textContent = currentTrack.title;
            trackPopupOverlay.style.display = "flex";
            setTimeout(() => {
              trackPopupOverlay.style.display = "none";
            }, 5000);
          }
        }
      }

      if (data.type === 'track_end') {
        const finishedTrack = currentTrack;
        currentTrack = null;
        trackBanner.style.display = "none";

        // If a track just finished, pop up the word cloud prompt
        if (finishedTrack) {
          const wordCloudTitle = document.getElementById("wordCloudTitle");
          if (wordCloudTitle) {
            wordCloudTitle.textContent = `How did "${finishedTrack.title}" make you feel?`;
          }

          // Clear out old text/counters before showing
          if (commentEl) commentEl.value = "";
          if (charHintEl) charHintEl.textContent = "0 / 140";
          if (successMsgEl) successMsgEl.textContent = "";

          if (wordCloudModal) wordCloudModal.style.display = "flex";
        }
      }
    } catch (err) {
      console.error("Error parsing SSE data", err);
    }
  };
}

if (btnSkipWordCloud) {
  btnSkipWordCloud.addEventListener("click", () => {
    wordCloudModal.style.display = "none";
  });
}

if (btnCloseWordCloud) {
  btnCloseWordCloud.addEventListener("click", () => {
    const note = commentEl.value.trim();
    if (note) {
      recordEvent("note", note);
      setMessage(successMsgEl, "Note saved.", false);
      setTimeout(() => {
        setMessage(successMsgEl, "", false);
        wordCloudModal.style.display = "none";
      }, 1000); // short delay to show 'saved' before closing
    } else {
      // If empty, just close it
      wordCloudModal.style.display = "none";
    }
  });
}

function setMessage(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

// ---------- Render buttons ----------
const svgNS = "http://www.w3.org/2000/svg";

function polarToCart(centerX, centerY, radius, angleInDegrees) {
  const a = (angleInDegrees - 90) * Math.PI / 180.0;
  return {
    x: centerX + (radius * Math.cos(a)),
    y: centerY + (radius * Math.sin(a))
  };
}

function getWedgePath(cx, cy, rIn, rOut, startAngle, endAngle) {
  const startOut = polarToCart(cx, cy, rOut, startAngle);
  const endOut = polarToCart(cx, cy, rOut, endAngle);
  const startIn = polarToCart(cx, cy, rIn, startAngle);
  const endIn = polarToCart(cx, cy, rIn, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M", startOut.x, startOut.y,
    "A", rOut, rOut, 0, largeArcFlag, 1, endOut.x, endOut.y,
    "L", endIn.x, endIn.y,
    "A", rIn, rIn, 0, largeArcFlag, 0, startIn.x, startIn.y,
    "Z"
  ].join(" ");
}

// Helper to check luminance and pick black or white for text on color
function getContrastYIQ(hexcolor) {
  // fallback for HSL values during hover
  if (hexcolor.startsWith('hsl')) return '#ffffff';

  if (hexcolor.slice(0, 1) === '#') {
    hexcolor = hexcolor.slice(1);
  }
  if (hexcolor.length === 3) {
    hexcolor = hexcolor.split('').map(function (hex) {
      return hex + hex;
    }).join('');
  }
  var r = parseInt(hexcolor.substr(0, 2), 16);
  var g = parseInt(hexcolor.substr(2, 2), 16);
  var b = parseInt(hexcolor.substr(4, 2), 16);
  var yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 128) ? '#000000' : '#ffffff';
}

function updateColorDisplay(disp, text, bgColor) {
  if (!disp) return;
  disp.textContent = text;
  if (text) {
    disp.style.backgroundColor = bgColor;
    disp.style.color = getContrastYIQ(bgColor);
    disp.style.opacity = "1";
  } else {
    disp.style.backgroundColor = "transparent";
    disp.style.opacity = "0";
  }
}

function renderButtons() {
  if (moodButtonsWrap) {
    moodButtonsWrap.innerHTML = "";
    if (moodSuccessOverlay) moodButtonsWrap.appendChild(moodSuccessOverlay);
  }
  if (colorWheelWrap) {
    // Inject the center display explicitly styled to live within the hole with easing
    colorWheelWrap.innerHTML = '<div id="colorNameDisplay" class="selected-color-name" style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); pointer-events:none; z-index:10; font-weight:800; font-size: 0.8rem; text-align:center; transition: all 0.3s ease; border-radius: 50%; width: 55px; height: 55px; display: flex; align-items: center; justify-content: center; opacity: 0;"></div>';
    if (colorSuccessOverlay) colorWheelWrap.appendChild(colorSuccessOverlay);
  }

  // Render Mood Wheel as Pie
  if (moodButtonsWrap && MOODS.length > 0) {
    const width = 280;
    const height = 280;
    const cx = 140;
    const cy = 140;
    const rOut = 135;
    const rIn = 30;

    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.overflow = "visible";

    const step = 360 / MOODS.length;
    MOODS.forEach((m, idx) => {
      const g = document.createElementNS(svgNS, "g");

      const startAngle = idx * step;
      const endAngle = startAngle + step;

      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", getWedgePath(cx, cy, rIn, rOut, startAngle, endAngle));
      path.classList.add("mood-wedge");
      path.dataset.mood = m;

      path.style.fill = "rgba(255, 255, 255, 0.08)";
      path.style.stroke = "rgba(255, 255, 255, 0.2)";
      path.style.strokeWidth = "1";
      path.style.cursor = "pointer";
      path.style.transition = "fill 0.2s, transform 0.1s";

      const midAngle = startAngle + step / 2;
      const tRad = rIn + (rOut - rIn) / 2;
      const pText = polarToCart(cx, cy, tRad, midAngle);

      let rot = midAngle - 90;
      if (midAngle > 180) rot += 180;

      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", pText.x);
      text.setAttribute("y", pText.y);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.setAttribute("transform", `rotate(${rot}, ${pText.x}, ${pText.y})`);
      text.textContent = m;
      text.style.fill = "var(--text)";
      text.style.fontSize = "0.75rem";
      text.style.fontWeight = "600";
      text.style.pointerEvents = "none";

      g.appendChild(path);
      g.appendChild(text);

      g.addEventListener("mouseenter", () => {
        path.style.fill = "rgba(255, 255, 255, 0.18)";
      });
      g.addEventListener("mouseleave", () => {
        if (!path.classList.contains("active")) {
          // check if there's a base color syncing happenning
          if (currentSelections.colorHex) {
            const rawColor = currentSelections.colorHex;
            if (rawColor.startsWith('#')) {
              const r = parseInt(rawColor.slice(1, 3), 16);
              const g = parseInt(rawColor.slice(3, 5), 16);
              const b = parseInt(rawColor.slice(5, 7), 16);
              path.style.fill = `rgba(${r}, ${g}, ${b}, 0.3)`;
            } else if (rawColor.startsWith('hsl')) {
              path.style.fill = rawColor.replace('hsl', 'hsla').replace(')', ', 0.3)');
            } else {
              path.style.fill = "rgba(255, 255, 255, 0.08)";
            }
          } else {
            path.style.fill = "rgba(255, 255, 255, 0.08)";
          }
        }
      });
      g.addEventListener("click", () => {
        const isActive = path.classList.contains("active");

        const allPaths = document.querySelectorAll(".mood-wedge");
        allPaths.forEach(p => {
          p.classList.remove("active");

          if (currentSelections.colorHex) {
            const rawColor = currentSelections.colorHex;
            if (rawColor.startsWith('#')) {
              const r = parseInt(rawColor.slice(1, 3), 16);
              const g = parseInt(rawColor.slice(3, 5), 16);
              const b = parseInt(rawColor.slice(5, 7), 16);
              p.style.fill = `rgba(${r}, ${g}, ${b}, 0.3)`;
            } else if (rawColor.startsWith('hsl')) {
              p.style.fill = rawColor.replace('hsl', 'hsla').replace(')', ', 0.3)');
            } else {
              p.style.fill = "rgba(255, 255, 255, 0.08)";
            }
          } else {
            p.style.fill = "rgba(255, 255, 255, 0.08)";
          }
        });

        if (isActive) {
          selectedMood = null;
        } else {
          path.classList.add("active");
          if (currentSelections.colorHex) {
            const rawColor = currentSelections.colorHex;
            if (rawColor.startsWith('#')) {
              const r = parseInt(rawColor.slice(1, 3), 16);
              const g = parseInt(rawColor.slice(3, 5), 16);
              const b = parseInt(rawColor.slice(5, 7), 16);
              path.style.fill = `rgba(${r}, ${g}, ${b}, 0.8)`;
            } else if (rawColor.startsWith('hsl')) {
              path.style.fill = rawColor.replace('hsl', 'hsla').replace(')', ', 0.8)');
            } else {
              path.style.fill = "rgba(255, 255, 255, 0.35)";
            }
          } else {
            path.style.fill = "rgba(255, 255, 255, 0.35)";
          }
          selectedMood = m;
          document.documentElement.style.setProperty("--moodGlow", currentSelections.colorHex || "rgba(255, 255, 255, 0.2)");
        }

        recordEvent("mood", m);
        handleSelection("mood", m, currentSelections.colorHex || "rgba(255, 255, 255, 0.2)");
      });

      svg.appendChild(g);
    });

    moodButtonsWrap.appendChild(svg);
    moodButtonsWrap.style.width = width + "px";
    moodButtonsWrap.style.height = height + "px";
  }

  // Render Color Wheel (Outer and Inner Rings)
  if (colorWheelWrap && COLORS.length > 0) {
    const width = 280;
    const height = 280;
    const cx = 140;
    const cy = 140;

    // Outer Wheel Specs
    const outerROut = 140;
    const outerRIn = 80;
    // Inner Wheel Specs
    const innerROut = 80;
    const innerRIn = 30;

    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.overflow = "visible";

    // Draw Inner Wheel (Half colors, half saturated)
    // We only take every second color
    const innerColors = COLORS.filter((_, i) => i % 2 === 0);
    const innerStep = 360 / innerColors.length;

    innerColors.forEach((c, idx) => {
      const startAngle = idx * innerStep;
      const endAngle = startAngle + innerStep;

      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", getWedgePath(cx, cy, innerRIn, innerROut, startAngle, endAngle));
      path.classList.add("color-wedge");
      path.dataset.colorName = "Light " + c.name;

      const hsl = hexToHSL(c.hex);
      path.style.fill = `hsl(${hsl.h}, ${hsl.s / 2}%, ${hsl.l}%)`;
      path.style.stroke = "rgba(255, 255, 255, 0.15)";
      path.style.strokeWidth = "1";
      path.style.cursor = "pointer";
      path.style.transition = "transform 0.1s, stroke 0.3s ease";

      const g = document.createElementNS(svgNS, "g");
      g.appendChild(path);

      g.addEventListener("mouseenter", () => {
        path.style.stroke = "#fff";
        path.style.strokeWidth = "2";
        const disp = document.getElementById("colorNameDisplay");
        updateColorDisplay(disp, path.dataset.colorName, path.style.fill);
      });
      g.addEventListener("mouseleave", () => {
        if (!path.classList.contains("active")) {
          path.style.stroke = "rgba(255, 255, 255, 0.15)";
          path.style.strokeWidth = "1";
        }
        const disp = document.getElementById("colorNameDisplay");
        if (selectedColor && path.classList.contains("active")) {
          // do nothing, active handles it
        } else if (selectedColor) {
          updateColorDisplay(disp, "", "");
        } else {
          updateColorDisplay(disp, "", "");
        }
      });

      g.addEventListener("click", () => {
        const isActive = path.classList.contains("active");

        const allPaths = document.querySelectorAll(".color-wedge, .grayscale-swatch");
        allPaths.forEach(p => {
          p.classList.remove("active");
          if (p.classList.contains("color-wedge")) {
            p.style.stroke = "rgba(255, 255, 255, 0.15)";
            p.style.strokeWidth = "1";
          } else {
            p.style.transform = "scale(1)";
            p.style.boxShadow = "none";
          }
        });

        const disp = document.getElementById("colorNameDisplay");

        if (isActive) {
          selectedColor = null;
          updateColorDisplay(disp, "", ""); // clear if unselected
        } else {
          path.classList.add("active");
          path.style.stroke = "#fff";
          path.style.strokeWidth = "3";
          svg.appendChild(g); // bring front

          const cName = path.dataset.colorName;
          selectedColor = cName;
          // Hide preview when officially selected
          updateColorDisplay(disp, "", "");
        }

        recordEvent("color", path.dataset.colorName);
        handleSelection("color", path.dataset.colorName, path.style.fill);
      });

      svg.appendChild(g);
    });

    // Draw Outer Wheel (Fully saturated)
    const outerStep = 360 / COLORS.length;
    COLORS.forEach((c, idx) => {
      const startAngle = idx * outerStep;
      const endAngle = startAngle + outerStep;

      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", getWedgePath(cx, cy, outerRIn, outerROut, startAngle, endAngle));
      path.classList.add("color-wedge");
      path.dataset.colorName = c.name;

      path.style.fill = c.hex;
      path.style.stroke = "rgba(255, 255, 255, 0.15)";
      path.style.strokeWidth = "1";
      path.style.cursor = "pointer";
      path.style.transition = "transform 0.1s, stroke 0.3s ease";

      const g = document.createElementNS(svgNS, "g");
      g.appendChild(path);

      g.addEventListener("mouseenter", () => {
        path.style.stroke = "#fff";
        path.style.strokeWidth = "2";
        const disp = document.getElementById("colorNameDisplay");
        updateColorDisplay(disp, path.dataset.colorName, c.hex);
      });
      g.addEventListener("mouseleave", () => {
        if (!path.classList.contains("active")) {
          path.style.stroke = "rgba(255, 255, 255, 0.15)";
          path.style.strokeWidth = "1";
        }
        const disp = document.getElementById("colorNameDisplay");
        if (selectedColor && path.classList.contains("active")) {
          // do nothing, active handles it
        } else if (selectedColor) {
          updateColorDisplay(disp, "", "");
        } else {
          updateColorDisplay(disp, "", "");
        }
      });

      g.addEventListener("click", () => {
        const isActive = path.classList.contains("active");

        const allPaths = document.querySelectorAll(".color-wedge, .grayscale-swatch");
        allPaths.forEach(p => {
          p.classList.remove("active");
          if (p.classList.contains("color-wedge")) {
            p.style.stroke = "rgba(255, 255, 255, 0.15)";
            p.style.strokeWidth = "1";
          } else {
            p.style.transform = "scale(1)";
            p.style.boxShadow = "none";
          }
        });

        const disp = document.getElementById("colorNameDisplay");

        if (isActive) {
          selectedColor = null;
          updateColorDisplay(disp, "", ""); // clear if unselected
        } else {
          path.classList.add("active");
          path.style.stroke = "#fff";
          path.style.strokeWidth = "3";
          svg.appendChild(g); // bring front

          const cName = path.dataset.colorName;
          selectedColor = cName;
          // Hide preview when officially selected
          updateColorDisplay(disp, "", "");
        }

        recordEvent("color", path.dataset.colorName);
        handleSelection("color", path.dataset.colorName, c.hex);
      });

      svg.appendChild(g);
    });

    colorWheelWrap.appendChild(svg);
    colorWheelWrap.style.width = width + "px";
    colorWheelWrap.style.height = height + "px";
  }
}

// ---------- Reaction Logic ----------
function setReaction(val) {
  let reactionVal = "meh";
  if (val === 1) reactionVal = "like";
  if (val === 2) reactionVal = "applause";

  if (currentSelections.reaction === reactionVal) {
    // If clicking the same reaction, deselect it
    handleSelection("reaction", reactionVal);
    // handleSelection understands this as a toggle
    return;
  }

  recordEvent("reaction", reactionVal);
  handleSelection("reaction", reactionVal);
}

if (btnMeh) btnMeh.addEventListener("click", () => setReaction(0));
if (btnLike) btnLike.addEventListener("click", () => setReaction(1));
if (btnApplause) btnApplause.addEventListener("click", () => setReaction(2));

if (btnPopupMeh) btnPopupMeh.addEventListener("click", () => {
  setReaction(0);
  setTimeout(() => { if (strengthModal) strengthModal.style.display = "none"; }, 5000);
});
if (btnPopupLike) btnPopupLike.addEventListener("click", () => {
  setReaction(1);
  setTimeout(() => { if (strengthModal) strengthModal.style.display = "none"; }, 5000);
});
if (btnPopupApplause) btnPopupApplause.addEventListener("click", () => {
  setReaction(2);
  setTimeout(() => { if (strengthModal) strengthModal.style.display = "none"; }, 5000);
});

if (btnCloseStrength) {
  btnCloseStrength.addEventListener("click", () => {
    strengthModal.style.display = "none";
  });
}

// ---------- Character counter ----------
commentEl.addEventListener("input", () => {
  const len = commentEl.value.length;
  charHintEl.textContent = `${len} / 140`;
});

if (continuousCommentEl && continuousCharHintEl) {
  continuousCommentEl.addEventListener("input", () => {
    const len = continuousCommentEl.value.length;
    continuousCharHintEl.textContent = `${len} / 140`;
  });
}

if (btnSubmitContinuousNote && continuousCommentEl) {
  btnSubmitContinuousNote.addEventListener("click", () => {
    const note = continuousCommentEl.value.trim();
    if (note) {
      recordEvent("note", note);
      
      if (noteCardBody) noteCardBody.style.opacity = "0";
      if (noteSuccessOverlay) {
        noteSuccessOverlay.classList.add("show");
        setTimeout(() => {
          noteSuccessOverlay.classList.remove("show");
          if (noteCardBody) noteCardBody.style.opacity = "1";
          continuousCommentEl.value = "";
          if (continuousCharHintEl) continuousCharHintEl.textContent = "0 / 140";
        }, 1500);
      } else {
        continuousCommentEl.value = "";
        continuousCharHintEl.textContent = "0 / 140";
      }
    }
  });
}

// ---------- Removed local data features and charts ----------

// ---------- Init ----------
async function initializeApp() {
  await loadConfiguration();
  checkIdentity();
}

initializeApp();