// ============================================================
// Campus Energy Saver Planner - Core Application Logic
// ============================================================

const STORAGE_KEY = "campus_energy_planner_v2";
const TARIFF_INR_PER_KWH = 8.5; // ₹8.50 per kWh

// Per-unit rated wattage for each device type
const UNIT_WATTS = {
  lights: 30,     // 30W per LED tube/panel
  fans: 75,       // 75W per ceiling fan
  projector: 250, // 250W per projector
  ac: 1500        // 1500W (1.5 kW) per split AC
};

// Timeframe multipliers (hours of operation)
const TIMEFRAMES = {
  hour:  { label: "Hour-wise",  hours: 1,       unit: "kWh / hr",    costTitle: "Estimated Hourly Cost" },
  day:   { label: "Day-wise",   hours: 8,       unit: "kWh / day",   costTitle: "Estimated Daily Cost (8h)" },
  month: { label: "Month-wise", hours: 8 * 26,  unit: "kWh / month", costTitle: "Estimated Monthly Cost (26d)" }
};

// Pre-populated realistic classrooms
const DEFAULT_CLASSROOMS = [
  {
    id: "room-101",
    name: "Room 101",
    floor: "1st Floor, Main Block",
    occupied: true,
    voltage: 231,
    appliances: {
      lights:    { count: 4, on: true },
      fans:      { count: 3, on: true },
      projector: { count: 1, on: true },
      ac:        { count: 1, on: true }
    }
  },
  {
    id: "room-201",
    name: "Room 201",
    floor: "2nd Floor, Main Block",
    occupied: false, // Empty with AC & Lights left ON -> Wastage Alert!
    voltage: 233,
    appliances: {
      lights:    { count: 4, on: true },
      fans:      { count: 2, on: false },
      projector: { count: 1, on: false },
      ac:        { count: 1, on: true }
    }
  },
  {
    id: "lab-302",
    name: "Computer Lab 302",
    floor: "3rd Floor, IT Wing",
    occupied: false, // Empty with Projector, Fans & 2 ACs left ON -> High Wastage!
    voltage: 229,
    appliances: {
      lights:    { count: 6, on: true },
      fans:      { count: 4, on: true },
      projector: { count: 1, on: true },
      ac:        { count: 2, on: true }
    }
  },
  {
    id: "room-104",
    name: "Seminar Hall 104",
    floor: "Ground Floor, Admin Block",
    occupied: false, // Efficient / All OFF
    voltage: 230,
    appliances: {
      lights:    { count: 6, on: false },
      fans:      { count: 4, on: false },
      projector: { count: 1, on: false },
      ac:        { count: 2, on: false }
    }
  }
];

// Application State
let classrooms = loadClassrooms();
let currentTimeframe = "hour"; // 'hour' | 'day' | 'month'
let currentFilter = "all";     // 'all' | 'wastage' | 'occupied' | 'empty'
let graphsVisible = false;

// Chart.js instances
let applianceChart = null;
let classroomChart = null;
let trendChart = null;

// ============================================================
// Initialization & Persistence
// ============================================================
function loadClassrooms() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (err) {
    console.warn("Could not read localStorage:", err);
  }
  return JSON.parse(JSON.stringify(DEFAULT_CLASSROOMS));
}

function saveClassrooms() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(classrooms));
  } catch (err) {
    console.warn("Could not save to localStorage:", err);
  }
}

// ============================================================
// Energy Calculation Helpers
// ============================================================
function getDeviceActiveWatts(room, key) {
  const item = room.appliances[key];
  if (!item || !item.on || item.count <= 0) return 0;
  return item.count * UNIT_WATTS[key];
}

function getDeviceRatedWatts(room, key) {
  const item = room.appliances[key];
  if (!item || item.count <= 0) return 0;
  return item.count * UNIT_WATTS[key];
}

function getRoomLiveWatts(room) {
  return (
    getDeviceActiveWatts(room, "lights") +
    getDeviceActiveWatts(room, "fans") +
    getDeviceActiveWatts(room, "projector") +
    getDeviceActiveWatts(room, "ac")
  );
}

function getRoomStatus(room) {
  const liveWatts = getRoomLiveWatts(room);
  if (!room.occupied && liveWatts > 0) {
    return {
      code: "wastage",
      label: "Wastage Detected!",
      badgeClass: "badge-wastage",
      cardClass: "status-wastage",
      icon: "fa-triangle-exclamation"
    };
  }
  if (room.occupied && liveWatts > 0) {
    return {
      code: "active",
      label: "Active / Occupied",
      badgeClass: "badge-active",
      cardClass: "status-active",
      icon: "fa-users"
    };
  }
  return {
    code: "efficient",
    label: "Efficient / Standby",
    badgeClass: "badge-efficient",
    cardClass: "status-efficient",
    icon: "fa-leaf"
  };
}

// ============================================================
// Render Full Dashboard
// ============================================================
function renderDashboard() {
  const tf = TIMEFRAMES[currentTimeframe];

  let occupiedCount = 0;
  let activeRoomsCount = 0;
  let totalLiveWatts = 0;
  let totalWastedWatts = 0;
  let wastedRoomsCount = 0;

  classrooms.forEach((room) => {
    const watts = getRoomLiveWatts(room);
    if (room.occupied) occupiedCount++;
    if (watts > 0) activeRoomsCount++;
    totalLiveWatts += watts;

    if (!room.occupied && watts > 0) {
      wastedRoomsCount++;
      totalWastedWatts += watts;
    }
  });

  const totalLiveKw = totalLiveWatts / 1000;
  const periodKwh = totalLiveKw * tf.hours;
  const periodCost = periodKwh * TARIFF_INR_PER_KWH;

  const wastedKw = totalWastedWatts / 1000;
  const wastedPeriodCost = wastedKw * tf.hours * TARIFF_INR_PER_KWH;

  // Update Top KPIs
  document.getElementById("kpiActiveRooms").textContent = `${activeRoomsCount} / ${classrooms.length}`;
  document.getElementById("kpiOccupiedText").textContent = `${occupiedCount} Occupied · ${classrooms.length - occupiedCount} Empty`;

  document.getElementById("kpiEnergyLabel").textContent = `${tf.label} Consumption`;
  document.getElementById("kpiTotalPower").textContent = `${periodKwh.toFixed(2)} kWh`;
  document.getElementById("kpiEnergySub").textContent = `Live Load: ${totalLiveWatts.toLocaleString()} W (${totalLiveKw.toFixed(2)} kW)`;

  document.getElementById("kpiCostLabel").textContent = tf.costTitle;
  document.getElementById("kpiEstCost").textContent = `₹${periodCost.toFixed(2)}`;

  const alertCard = document.getElementById("kpiAlertCard");
  document.getElementById("kpiWastageCount").textContent = `${wastedRoomsCount} ${wastedRoomsCount === 1 ? "Room" : "Rooms"}`;
  if (wastedRoomsCount > 0) {
    alertCard.classList.add("alert-pulse");
    document.getElementById("kpiWastageSub").textContent = `Wasting ${totalWastedWatts.toLocaleString()} W (₹${wastedPeriodCost.toFixed(2)} / ${currentTimeframe})`;
  } else {
    alertCard.classList.remove("alert-pulse");
    document.getElementById("kpiWastageSub").textContent = "Zero avoidable energy waste";
  }

  // Update timeframe tags
  document.getElementById("graphTimeframeTag").textContent = tf.label;
  document.getElementById("advisorTimeframeTag").textContent = tf.label;
  document.querySelectorAll(".unit-label").forEach((el) => (el.textContent = tf.unit));

  renderAdvisor(tf, totalWastedWatts, wastedRoomsCount);
  renderClassrooms(tf);

  if (graphsVisible) {
    renderCharts(tf);
  }
}

// ============================================================
// Render Energy Saver Advisor
// ============================================================
function renderAdvisor(tf, totalWastedWatts, wastedRoomsCount) {
  const advisorList = document.getElementById("advisorList");
  const shutdownAllBtn = document.getElementById("shutdownAllWastedBtn");
  advisorList.innerHTML = "";

  if (wastedRoomsCount > 0) {
    shutdownAllBtn.classList.remove("hidden");
  } else {
    shutdownAllBtn.classList.add("hidden");
  }

  const cards = [];

  classrooms.forEach((room) => {
    const liveWatts = getRoomLiveWatts(room);
    if (!room.occupied && liveWatts > 0) {
      const activeNames = [];
      if (room.appliances.ac.on && room.appliances.ac.count > 0) activeNames.push(`${room.appliances.ac.count} AC`);
      if (room.appliances.projector.on && room.appliances.projector.count > 0) activeNames.push(`${room.appliances.projector.count} Projector`);
      if (room.appliances.fans.on && room.appliances.fans.count > 0) activeNames.push(`${room.appliances.fans.count} Fans`);
      if (room.appliances.lights.on && room.appliances.lights.count > 0) activeNames.push(`${room.appliances.lights.count} Lights`);

      const periodKwh = (liveWatts / 1000) * tf.hours;
      const savingsInr = periodKwh * TARIFF_INR_PER_KWH;

      cards.push(`
        <div class="advisor-item warning">
          <div>
            <div class="advisor-item-top">
              <h4><i class="fa-solid fa-triangle-exclamation"></i> ${room.name} (${room.floor})</h4>
              <span class="mono" style="font-weight:700;color:#b91c1c;">${liveWatts} W</span>
            </div>
            <p>Room is <strong>Empty</strong> with <strong>${activeNames.join(", ")}</strong> still ON. Turning off saves <strong>${periodKwh.toFixed(2)} kWh (₹${savingsInr.toFixed(2)})</strong> on a ${tf.label.toLowerCase()} basis.</p>
          </div>
          <div>
            <button class="btn btn-danger btn-sm" onclick="turnOffRoomAll('${room.id}')">
              <i class="fa-solid fa-power-off"></i> Shut Down ${room.name}
            </button>
          </div>
        </div>
      `);
    }
  });

  // General Smart Recommendations
  const totalAcWatts = classrooms.reduce((sum, r) => sum + getDeviceActiveWatts(r, "ac"), 0);
  if (totalAcWatts > 0) {
    const acPeriodSavings = ((totalAcWatts * 0.15) / 1000) * tf.hours * TARIFF_INR_PER_KWH;
    cards.push(`
      <div class="advisor-item tip">
        <div>
          <h4><i class="fa-solid fa-temperature-arrow-up"></i> AC Thermostat Optimization (24°C–25°C)</h4>
          <p>Active ACs are drawing <strong>${totalAcWatts.toLocaleString()} W</strong>. Raising setpoints by 2°C reduces compressor load by ~15%, saving <strong>₹${acPeriodSavings.toFixed(2)}</strong> (${tf.label.toLowerCase()}).</p>
        </div>
      </div>
    `);
  }

  if (cards.length === 0) {
    cards.push(`
      <div class="advisor-item">
        <div>
          <h4><i class="fa-solid fa-circle-check"></i> Optimal Campus Efficiency</h4>
          <p>All unoccupied classrooms have their appliances turned OFF. Zero energy wastage detected right now.</p>
        </div>
      </div>
    `);
  }

  advisorList.innerHTML = cards.join("");
}

// ============================================================
// Render Classroom Cards
// ============================================================
function renderClassrooms(tf) {
  const grid = document.getElementById("classroomsGrid");
  grid.innerHTML = "";

  const filtered = classrooms.filter((room) => {
    const status = getRoomStatus(room);
    if (currentFilter === "wastage") return status.code === "wastage";
    if (currentFilter === "occupied") return room.occupied;
    if (currentFilter === "empty") return !room.occupied;
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<p style="color:#64748b;grid-column:1/-1;padding:1rem;">No classrooms match the selected filter.</p>`;
    return;
  }

  const deviceMeta = [
    { key: "lights",    label: "Lights",     icon: "fa-regular fa-lightbulb" },
    { key: "fans",      label: "Fans",       icon: "fa-solid fa-fan" },
    { key: "projector", label: "Projector",  icon: "fa-solid fa-video" },
    { key: "ac",        label: "AC Units",   icon: "fa-solid fa-snowflake" }
  ];

  filtered.forEach((room) => {
    const status = getRoomStatus(room);
    const liveWatts = getRoomLiveWatts(room);
    const liveKw = liveWatts / 1000;
    const periodKwh = liveKw * tf.hours;
    const periodCost = periodKwh * TARIFF_INR_PER_KWH;
    const amps = (liveWatts / room.voltage).toFixed(1);

    const appliancesHtml = deviceMeta
      .map((dev) => {
        const item = room.appliances[dev.key];
        const hasDevices = item.count > 0;
        const isOn = hasDevices && item.on;
        const activeW = getDeviceActiveWatts(room, dev.key);
        const ratedW = getDeviceRatedWatts(room, dev.key);

        return `
          <div class="appliance-row ${isOn ? "is-on" : ""}">
            <div class="appliance-info">
              <div class="appliance-icon"><i class="${dev.icon}"></i></div>
              <div>
                <div class="app-name">
                  <span>${item.count} × ${dev.label}</span>
                  <span class="state-pill ${isOn ? "on" : "off"}">${isOn ? "ON" : "OFF"}</span>
                </div>
                <div class="app-meta mono">
                  ${isOn ? `Using <strong>${activeW} W</strong>` : `0 W`} (Rated: ${ratedW} W)
                </div>
              </div>
            </div>
            <label class="switch" title="Toggle ${dev.label}">
              <input type="checkbox" ${isOn ? "checked" : ""} ${!hasDevices ? "disabled" : ""}
                onchange="toggleAppliance('${room.id}', '${dev.key}')" />
              <span class="slider"></span>
            </label>
          </div>
        `;
      })
      .join("");

    const card = document.createElement("article");
    card.className = `room-card ${status.cardClass}`;
    card.innerHTML = `
      <div class="room-header">
        <div>
          <h3 class="room-title">${room.name}</h3>
          <div class="room-floor"><i class="fa-solid fa-location-dot"></i> ${room.floor}</div>
        </div>
        <span class="status-badge ${status.badgeClass}">
          <i class="fa-solid ${status.icon}"></i> ${status.label}
        </span>
      </div>

      <div class="occupancy-bar">
        <span>Occupancy Status:</span>
        <button class="occ-toggle-btn ${room.occupied ? "occupied" : "empty"}" onclick="toggleOccupancy('${room.id}')">
          <i class="fa-solid ${room.occupied ? "fa-user-check" : "fa-door-open"}"></i>
          ${room.occupied ? "Occupied (Click to mark Empty)" : "Empty (Click to mark Occupied)"}
        </button>
      </div>

      <div class="smart-meter">
        <div class="meter-cell">
          <span>Live Power</span>
          <strong class="live-watts">${liveWatts} W</strong>
        </div>
        <div class="meter-cell">
          <span>${tf.label} Usage</span>
          <strong>${periodKwh.toFixed(2)} kWh</strong>
        </div>
        <div class="meter-cell">
          <span>Voltage / Load</span>
          <strong>${room.voltage}V · ${amps}A</strong>
        </div>
      </div>

      <div class="appliances-list">
        ${appliancesHtml}
      </div>

      <div class="room-footer">
        <span class="timeframe-summary">
          ${tf.label} Cost: <strong class="mono">₹${periodCost.toFixed(2)}</strong>
        </span>
        <div style="display:flex;gap:0.4rem;">
          <button class="btn btn-sm btn-outline" onclick="turnOffRoomAll('${room.id}')" ${liveWatts === 0 ? "disabled" : ""}>
            <i class="fa-solid fa-power-off"></i> Turn Off All
          </button>
          <button class="btn btn-sm btn-outline" onclick="deleteRoom('${room.id}')" title="Remove Classroom">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

// ============================================================
// Render Charts (Chart.js)
// ============================================================
function renderCharts(tf) {
  const hours = tf.hours;

  // 1. Appliance Breakdown Data
  let lightsKwh = 0, fansKwh = 0, projKwh = 0, acKwh = 0;
  classrooms.forEach((r) => {
    lightsKwh += (getDeviceActiveWatts(r, "lights") / 1000) * hours;
    fansKwh   += (getDeviceActiveWatts(r, "fans") / 1000) * hours;
    projKwh   += (getDeviceActiveWatts(r, "projector") / 1000) * hours;
    acKwh     += (getDeviceActiveWatts(r, "ac") / 1000) * hours;
  });

  const ctxApp = document.getElementById("applianceChart").getContext("2d");
  if (applianceChart) applianceChart.destroy();
  applianceChart = new Chart(ctxApp, {
    type: "doughnut",
    data: {
      labels: ["AC Units", "Projectors", "Fans", "Lights"],
      datasets: [{
        data: [acKwh.toFixed(2), projKwh.toFixed(2), fansKwh.toFixed(2), lightsKwh.toFixed(2)],
        backgroundColor: ["#ef4444", "#f59e0b", "#3b82f6", "#10b981"],
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } }
    }
  });

  // 2. Classroom Breakdown Data
  const roomLabels = classrooms.map((r) => r.name);
  const roomData = classrooms.map((r) => Number(((getRoomLiveWatts(r) / 1000) * hours).toFixed(2)));
  const roomColors = classrooms.map((r) => {
    const st = getRoomStatus(r).code;
    return st === "wastage" ? "#ef4444" : st === "active" ? "#f59e0b" : "#10b981";
  });

  const ctxRoom = document.getElementById("classroomChart").getContext("2d");
  if (classroomChart) classroomChart.destroy();
  classroomChart = new Chart(ctxRoom, {
    type: "bar",
    data: {
      labels: roomLabels,
      datasets: [{
        label: `Consumption (${tf.unit})`,
        data: roomData,
        backgroundColor: roomColors,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });

  // 3. Time-Series Profile based on selected Timeframe
  const totalLiveKw = classrooms.reduce((sum, r) => sum + getRoomLiveWatts(r) / 1000, 0);
  let trendLabels = [];
  let trendFactors = [];
  let trendTitle = "";

  if (currentTimeframe === "hour") {
    trendTitle = "Hourly Campus Load Profile (8 AM – 5 PM)";
    trendLabels = ["8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM"];
    trendFactors = [0.45, 0.75, 0.95, 1.0, 0.9, 0.7, 0.95, 0.9, 0.65, 0.35];
  } else if (currentTimeframe === "day") {
    trendTitle = "Day-wise Weekly Consumption (Mon – Sat)";
    trendLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    trendFactors = [0.95, 1.0, 0.92, 0.98, 0.88, 0.55];
  } else {
    trendTitle = "Month-wise Academic Term Trend (Jan – Jun)";
    trendLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
    trendFactors = [0.72, 0.8, 0.92, 1.0, 0.85, 0.65];
  }

  document.getElementById("trendChartTitle").textContent = trendTitle;
  const trendValues = trendFactors.map((f) => Number((totalLiveKw * hours * f).toFixed(2)));

  const ctxTrend = document.getElementById("trendChart").getContext("2d");
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctxTrend, {
    type: "line",
    data: {
      labels: trendLabels,
      datasets: [{
        label: `Projected (${tf.unit})`,
        data: trendValues,
        borderColor: "#10b981",
        backgroundColor: "rgba(16, 185, 129, 0.14)",
        fill: true,
        tension: 0.35,
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

// ============================================================
// User Interactive Controls
// ============================================================
window.toggleAppliance = function (roomId, deviceKey) {
  const room = classrooms.find((r) => r.id === roomId);
  if (!room) return;
  room.appliances[deviceKey].on = !room.appliances[deviceKey].on;
  saveClassrooms();
  renderDashboard();
};

window.toggleOccupancy = function (roomId) {
  const room = classrooms.find((r) => r.id === roomId);
  if (!room) return;
  room.occupied = !room.occupied;
  saveClassrooms();
  renderDashboard();
  showToast(`${room.name} marked as ${room.occupied ? "Occupied" : "Empty"}.`);
};

window.turnOffRoomAll = function (roomId) {
  const room = classrooms.find((r) => r.id === roomId);
  if (!room) return;
  Object.keys(room.appliances).forEach((k) => {
    room.appliances[k].on = false;
  });
  saveClassrooms();
  renderDashboard();
  showToast(`All appliances in ${room.name} turned OFF.`);
};

window.deleteRoom = function (roomId) {
  const room = classrooms.find((r) => r.id === roomId);
  if (!room) return;
  classrooms = classrooms.filter((r) => r.id !== roomId);
  saveClassrooms();
  renderDashboard();
  showToast(`Removed ${room.name}.`);
};

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add("hidden"), 2800);
}

// ============================================================
// Event Listeners
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  // Timeframe Switcher (Hour / Day / Month)
  document.querySelectorAll(".tf-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tf-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentTimeframe = btn.dataset.tf;
      renderDashboard();
    });
  });

  // Show / Hide Graphs Toggle
  const graphsPanel = document.getElementById("graphsPanel");
  const toggleGraphsBtn = document.getElementById("toggleGraphsBtn");
  const closeGraphsBtn = document.getElementById("closeGraphsBtn");

  function setGraphsVisibility(show) {
    graphsVisible = show;
    if (show) {
      graphsPanel.classList.remove("hidden");
      toggleGraphsBtn.querySelector("span").textContent = "Hide Graphs";
      renderCharts(TIMEFRAMES[currentTimeframe]);
    } else {
      graphsPanel.classList.add("hidden");
      toggleGraphsBtn.querySelector("span").textContent = "Show Graphs";
    }
  }

  toggleGraphsBtn.addEventListener("click", () => setGraphsVisibility(!graphsVisible));
  closeGraphsBtn.addEventListener("click", () => setGraphsVisibility(false));

  // Filter Pills
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderClassrooms(TIMEFRAMES[currentTimeframe]);
    });
  });

  // Shut Down All Wasted Rooms
  document.getElementById("shutdownAllWastedBtn").addEventListener("click", () => {
    classrooms.forEach((room) => {
      if (!room.occupied && getRoomLiveWatts(room) > 0) {
        Object.keys(room.appliances).forEach((k) => (room.appliances[k].on = false));
      }
    });
    saveClassrooms();
    renderDashboard();
    showToast("All unoccupied rooms shut down!");
  });

  // Reset Demo Data
  document.getElementById("resetDemoBtn").addEventListener("click", () => {
    classrooms = JSON.parse(JSON.stringify(DEFAULT_CLASSROOMS));
    saveClassrooms();
    renderDashboard();
    showToast("Demo classrooms restored.");
  });

  // Add Classroom Modal Logic
  const modal = document.getElementById("addRoomModal");
  const openModalBtn = document.getElementById("openAddModalBtn");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const cancelModalBtn = document.getElementById("cancelModalBtn");
  const form = document.getElementById("addRoomForm");

  function updateModalPreviewWatts() {
    const lights = Math.max(0, parseInt(document.getElementById("qtyLights").value) || 0);
    const fans   = Math.max(0, parseInt(document.getElementById("qtyFans").value) || 0);
    const proj   = Math.max(0, parseInt(document.getElementById("qtyProjectors").value) || 0);
    const acs    = Math.max(0, parseInt(document.getElementById("qtyAcs").value) || 0);

    const total = lights * UNIT_WATTS.lights + fans * UNIT_WATTS.fans + proj * UNIT_WATTS.projector + acs * UNIT_WATTS.ac;
    document.getElementById("modalPreviewWatts").textContent = `Rated Load: ${total.toLocaleString()} W`;
  }

  ["qtyLights", "qtyFans", "qtyProjectors", "qtyAcs"].forEach((id) => {
    document.getElementById(id).addEventListener("input", updateModalPreviewWatts);
  });

  openModalBtn.addEventListener("click", () => {
    form.reset();
    updateModalPreviewWatts();
    modal.classList.remove("hidden");
  });

  [closeModalBtn, cancelModalBtn].forEach((btn) => {
    btn.addEventListener("click", () => modal.classList.add("hidden"));
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("roomName").value.trim();
    const floor = document.getElementById("roomFloor").value.trim();
    const occupied = document.getElementById("roomOccupancy").value === "occupied";
    const initState = document.getElementById("initialPowerState").value;

    const qtyLights = Math.max(0, parseInt(document.getElementById("qtyLights").value) || 0);
    const qtyFans   = Math.max(0, parseInt(document.getElementById("qtyFans").value) || 0);
    const qtyProj   = Math.max(0, parseInt(document.getElementById("qtyProjectors").value) || 0);
    const qtyAcs    = Math.max(0, parseInt(document.getElementById("qtyAcs").value) || 0);

    const isAllOn = initState === "on";
    const isCustom = initState === "custom";

    const newRoom = {
      id: "room-" + Date.now(),
      name,
      floor,
      occupied,
      voltage: 230 + Math.floor(Math.random() * 4),
      appliances: {
        lights:    { count: qtyLights, on: qtyLights > 0 && (isAllOn || isCustom) },
        fans:      { count: qtyFans,   on: qtyFans > 0 && (isAllOn || isCustom) },
        projector: { count: qtyProj,   on: qtyProj > 0 && isAllOn },
        ac:        { count: qtyAcs,    on: qtyAcs > 0 && isAllOn }
      }
    };

    classrooms.unshift(newRoom);
    saveClassrooms();
    modal.classList.add("hidden");
    renderDashboard();
    showToast(`${name} added (${getRoomLiveWatts(newRoom)} W live load).`);
  });

  // Initial Render
  renderDashboard();
});