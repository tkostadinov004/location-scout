let currentBusinessType = "";
let rentableGeoJSON = null;
let activeCustomPoi = "";
let activeCustomPoiFetchMode = "";
let isDarkMode = false;
let rating_preferences = new Array(3);
let fetched_objects_of_same_type = null;
let additional_pois = null;

let tableFeatures = [];
let currentPage = 1;
const rowsPerPage = 20;

let currentMapFeatures = [];

let map;
let lightTileLayer, darkTileLayer;
let rentablePropertiesLayer, isochroneLayer, competitorsLayer, customPoiLayer;
let markerDictionary = {};

const school_icon = L.icon({
  iconUrl: "image?image_name=school.png",
  iconSize: [16, 16],
  iconAnchor: [8, 16],
  popupAnchor: [0, -16],
});
const park_icon = L.icon({
  iconUrl: "image?image_name=park.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});
const public_transport_icon = L.icon({
  iconUrl: "image?image_name=public_transport.png",
  iconSize: [16, 16],
  iconAnchor: [8, 16],
  popupAnchor: [0, -16],
});

const screens = {
  setup: document.getElementById("setup-screen"),
  questionnaire: document.getElementById("questionnaire-screen"),
  dashboard: document.getElementById("dashboard-screen"),
};

function showLoading() {
  document.getElementById("loading-overlay").style.display = "flex";
}

function hideLoading() {
  document.getElementById("loading-overlay").style.display = "none";
}

document.getElementById("business-type").addEventListener("input", function () {
  this.setCustomValidity("");
});

function clearQuestionError(questionId) {
  const err = document.getElementById(`${questionId}-error`);
  if (err) err.textContent = "";
}

document.querySelectorAll('input[name="q-traffic"]').forEach((input) => {
  input.addEventListener("change", () => clearQuestionError("q-traffic"));
});
document.querySelectorAll('input[name="q-parking"]').forEach((input) => {
  input.addEventListener("change", () => clearQuestionError("q-parking"));
});
document.querySelectorAll('input[name="q-demographic"]').forEach((input) => {
  input.addEventListener("change", () => clearQuestionError("q-demographic"));
});
document.getElementById("custom-poi").addEventListener("input", function () {
  this.setCustomValidity("");
});

document.getElementById("btn-next-questionnaire").addEventListener("click", () => {
  const typeInputEl = document.getElementById("business-type");
  const typeInput = typeInputEl.value.trim();

  if (!typeInput) {
    typeInputEl.setCustomValidity("Please enter the type of business you want to open.");
    typeInputEl.reportValidity();
    return;
  }

  currentBusinessType = typeInput;
  switchScreen("questionnaire");
});

document.getElementById("btn-skip").addEventListener("click", async () => {
  initializeDashboard();
  rentableGeoJSON = await apiFetchRentableObjects();
  renderMapFeatures(rentableGeoJSON);
});

document.getElementById("btn-submit-q").addEventListener("click", async () => {
  const q1El = document.querySelector('input[name="q-traffic"]:checked');
  const q2El = document.querySelector('input[name="q-parking"]:checked');
  const q3El = document.querySelector('input[name="q-demographic"]:checked');

  if (!q1El) {
    const err = document.getElementById("q-traffic-error");
    if (err) err.textContent = "Please answer this question, or click 'Skip'.";
    return;
  }
  if (!q2El) {
    const err = document.getElementById("q-parking-error");
    if (err) err.textContent = "Please answer this question, or click 'Skip'.";
    return;
  }
  if (!q3El) {
    const err = document.getElementById("q-demographic-error");
    if (err) err.textContent = "Please answer this question, or click 'Skip'.";
    return;
  }

  rating_preferences[0] = Number.parseInt(q1El.getAttribute("value"));
  rating_preferences[1] = Number.parseInt(q2El.getAttribute("value"));
  rating_preferences[2] = Number.parseInt(q3El.getAttribute("value"));

  initializeDashboard();
  rentableGeoJSON = await apiFetchRentableObjects();
  renderMapFeatures(rentableGeoJSON);
});

function switchScreen(screenName) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[screenName].classList.add("active");
}

async function initializeDashboard() {
  switchScreen("dashboard");

  if (!map) {
    map = L.map("map", { zoomControl: false }).setView([42.6977, 23.3219], 13);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    lightTileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    });

    darkTileLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CartoDB</a>',
    });

    lightTileLayer.addTo(map);

    isochroneLayer = L.layerGroup().addTo(map);
    competitorsLayer = L.layerGroup().addTo(map);
    customPoiLayer = L.layerGroup().addTo(map);
    rentablePropertiesLayer = L.layerGroup().addTo(map);

    const legend = L.control({ position: "bottomleft" });
    legend.onAdd = function (map) {
      const div = L.DomUtil.create("div", "info legend");
      div.innerHTML = `
            <h4>Map Legend</h4>
            <div class="legend-item gradient-container">
                <div class="gradient-bar"></div>
                <div class="gradient-labels"><span>0 (Poor Score)</span><span>1 (Best Score)</span></div>
            </div>
            <div class="legend-item"><span class="legend-isochrone"></span> 15-min walk isochrone</div>
            <div class="legend-item"><span class="legend-circle competitor"></span> Existing competitors</div>
            <div class="legend-item"><span class="legend-circle custom-poi"></span> Custom POI</div>
            <div class="legend-item"><img src="image?image_name=park.png" width="16" height="16"> Park</div>
            <div class="legend-item"><img src="image?image_name=school.png" width="16" height="16"> School</div>
            <div class="legend-item"><img src="image?image_name=public_transport.png" width="16" height="16"> Transit Stop</div>
        `;
      return div;
    };
    legend.addTo(map);
  }

  document.querySelectorAll(".criteria-cb").forEach((cb) => {
    cb.addEventListener("change", triggerRecalculation);
  });

  document.getElementById("btn-add-poi").addEventListener("click", () => {
    const customPoiEl = document.getElementById("custom-poi");
    const customPoiInput = customPoiEl.value.trim();

    if (!customPoiInput) {
      customPoiEl.setCustomValidity("Please enter a Point of Interest (e.g., 'Hospitals') before adding a rule.");
      customPoiEl.reportValidity();
      return;
    }

    activeCustomPoi = customPoiInput;

    const customPoiFetchMode = document.querySelector("input[name='additional-poi-extraction']:checked");
    activeCustomPoiFetchMode = customPoiFetchMode.getAttribute("value").trim() == "fast";
    triggerRecalculation();
  });

  document.getElementById("btn-remove-poi").addEventListener("click", () => {
    activeCustomPoi = "";
    document.getElementById("custom-poi").value = "";
    triggerRecalculation();
  });

  document.getElementById("btn-show-table").addEventListener("click", showModal);

  document.getElementById("close-modal").addEventListener("click", hideModal);

  document.getElementById("close-property-modal").addEventListener("click", () => {
    document.getElementById("property-modal").style.display = "none";
  });

  window.addEventListener("click", (e) => {
    if (e.target == document.getElementById("table-modal")) hideModal();
    if (e.target == document.getElementById("property-modal")) {
      document.getElementById("property-modal").style.display = "none";
    }
  });

  document.getElementById("btn-prev-page").addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderTablePage();
    }
  });
  document.getElementById("btn-next-page").addEventListener("click", () => {
    if (currentPage * rowsPerPage < tableFeatures.length) {
      currentPage++;
      renderTablePage();
    }
  });

  const toggleBtn = document.getElementById("btn-toggle-sidebar");
  const sidebar = document.getElementById("sidebar");

  toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    if (sidebar.classList.contains("collapsed")) {
      toggleBtn.innerHTML = "&rarr;";
    } else {
      toggleBtn.innerHTML = "&larr;";
    }
    setTimeout(() => {
      if (map) map.invalidateSize();
    }, 300);
  });

  const themeBtn = document.getElementById("btn-theme-toggle");
  themeBtn.addEventListener("click", () => {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle("dark-mode", isDarkMode);

    if (isDarkMode) {
      map.removeLayer(lightTileLayer);
      darkTileLayer.addTo(map);
      themeBtn.innerHTML = '<i class="fa-regular fa-sun"></i>';
    } else {
      map.removeLayer(darkTileLayer);
      lightTileLayer.addTo(map);
      themeBtn.innerHTML = '<i class="fa-regular fa-moon"></i>';
    }
  });
}

const resizer = document.getElementById("sidebar-resizer");
const root = document.documentElement;
let isResizing = false;

resizer.addEventListener("mousedown", (e) => {
  isResizing = true;
  resizer.classList.add("active");

  document.body.style.userSelect = "none";
  document.body.style.cursor = "ew-resize";
  if (map) map.dragging.disable();
});

document.addEventListener("mousemove", (e) => {
  if (!isResizing) return;

  let newWidth = e.clientX;

  if (newWidth < 250) newWidth = 250;
  const maxWidth = window.innerWidth * 0.7;
  if (newWidth > maxWidth) newWidth = maxWidth;

  root.style.setProperty("--sidebar-width", `${newWidth}px`);

  if (map) map.invalidateSize();
});

document.addEventListener("mouseup", () => {
  if (isResizing) {
    isResizing = false;
    resizer.classList.remove("active");

    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    if (map) map.dragging.enable();
  }
});

window.triggerPropertyModal = function (featureId) {
  const targetFeature = currentMapFeatures.find((f) => f.properties.id === featureId);
  if (targetFeature) {
    openPropertyModal(targetFeature);
  }
};

function renderMapFeatures(geoJSON) {
  rentablePropertiesLayer.clearLayers();
  markerDictionary = {};

  currentMapFeatures = geoJSON.features;

  L.geoJSON(geoJSON, {
    pointToLayer: (feature, latlng) => {
      const hue = feature.properties.total_score * 100;
      const color = `hsl(${hue}, 100%, 45%)`;

      const marker = L.circleMarker(latlng, {
        radius: 10,
        fillColor: color,
        color: "#fff",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.9,
      });

      const tooltipHtml = `
      <div style="text-align: center;">
          <b>${feature.properties.name}</b><br>
          Rent: ${feature.properties.rent_eur} ${!isNaN(feature.properties.rent_eur) ? "EUR" : ""} / ${feature.properties.rent_bgn} ${!isNaN(feature.properties.rent_bgn) ? "BGN" : ""}<br>
          <b>Total Score: ${feature.properties.total_score.toFixed(2)}</b><br>
          <button onclick="window.triggerPropertyModal(${feature.properties.id})" class="tooltip-btn">View Details</button>
      </div>
      `;

      marker.bindTooltip(tooltipHtml, { direction: "top", interactive: true });

      marker.bindPopup(tooltipHtml, {
        closeButton: false,
        autoPan: false,
        offset: [0, -10],
      });

      marker.on("click", async () => {
        map.setView(latlng, 15);

        marker.bringToFront();

        marker.closeTooltip();
        marker.openPopup();

        await handleMarkerClick(feature, latlng);
      });

      markerDictionary[feature.properties.id] = marker;
      return marker;
    },
  }).addTo(rentablePropertiesLayer);

  updateRankings(geoJSON.features);
  populateTable(geoJSON.features);
}

function openPropertyModal(feature) {
  const props = feature.properties;
  document.getElementById("prop-name").innerText = props.name;
  document.getElementById("prop-address").innerText = props.address || "Data unavailable";

  document.getElementById("prop-rent").innerText = `${props.rent_eur} ${!isNaN(props.rent_eur) ? "EUR" : ""} / ${props.rent_bgn} ${!isNaN(props.rent_bgn) ? "BGN" : ""}`;
  document.getElementById("prop-area").innerText = props.area;
  document.getElementById("prop-base-score").innerText = props.base_score.toFixed(2);
  document.getElementById("prop-total-score").innerText = props.total_score.toFixed(2);

  document.getElementById("prop-link").href = props.url;

  document.getElementById("property-modal").style.display = "block";
}

function display_additional_pois(feature, data, text, type) {
  let icon;
  switch (type) {
    case "park":
      icon = park_icon;
      break;
    case "school":
      icon = school_icon;
      break;
    case "public_transport":
      icon = public_transport_icon;
  }

  L.geoJSON(JSON.parse(data), {
    pointToLayer: (feat, ll) => {
      const marker = L.marker(ll, {
        icon: icon,
      });
      marker.bindTooltip(`Existing ${text}`, {
        direction: "top",
        opacity: 0.9,
      });
      return marker;
    },
  }).addTo(customPoiLayer);
}

async function handleMarkerClick(feature, latlng) {
  isochroneLayer.clearLayers();
  competitorsLayer.clearLayers();
  customPoiLayer.clearLayers();

  const isochroneData = JSON.parse(feature.properties.isochrone);
  L.geoJSON(isochroneData, {
    interactive: false,
    style: { color: "#0078d7", weight: 2, fillOpacity: 0.1 },
  }).addTo(isochroneLayer);

  if (fetched_objects_of_same_type) {
    const points = fetched_objects_of_same_type.features.map((feat) => {
      return {
        type: "Feature",
        properties: feat.properties,
        geometry: feat.properties.wkb_geometry_centroid,
      };
    });
    console.log(points);
    L.geoJSON(points, {
      pointToLayer: (feat, ll) => {
        const marker = L.circleMarker(ll, {
          radius: 6,
          fillColor: "#c49320",
          color: "#a87e1d",
          weight: 1,
          fillOpacity: 0.6,
        });
        marker.bindTooltip(`Existing ${currentBusinessType}`, {
          direction: "top",
          opacity: 0.9,
        });
        return marker;
      },
    }).addTo(competitorsLayer);
  }

  if (additional_pois) {
    const points = additional_pois.features.map((feat) => {
      return {
        type: "Feature",
        properties: feat.properties,
        geometry: feat.properties.wkb_geometry_centroid,
      };
    });
    console.log(points);
    L.geoJSON(points, {
      pointToLayer: (feat, ll) => {
        const marker = L.circleMarker(ll, {
          radius: 6,
          fillColor: "#780f65",
          color: "#c91ba9",
          weight: 1,
          fillOpacity: 0.6,
        });
        marker.bindTooltip(`Existing ${activeCustomPoi}`, {
          direction: "top",
          opacity: 0.9,
        });
        return marker;
      },
    }).addTo(customPoiLayer);
  }

  if (feature.properties.parks_in_isochrone) {
    display_additional_pois(feature, feature.properties.parks_in_isochrone, "park", "park");
  }

  if (feature.properties.schools_in_isochrone) {
    display_additional_pois(feature, feature.properties.schools_in_isochrone, "school", "school");
  }
  if (feature.properties.public_transport_stops_in_isochrone) {
    display_additional_pois(feature, feature.properties.public_transport_stops_in_isochrone, "public transport stop", "public_transport");
  }
}

function updateRankings(features) {
  const sorted = [...features].sort((a, b) => b.properties.total_score - a.properties.total_score);
  const top5 = sorted.slice(0, 5);
  const worst5 = sorted.slice(-5).reverse();

  const renderList = (listArr, containerId) => {
    const ul = document.getElementById(containerId);
    ul.innerHTML = "";
    listArr.forEach((feat) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${feat.properties.name}</span> <span class="score">${feat.properties.total_score.toFixed(2)}</span>`;
      li.addEventListener("click", () => {
        const marker = markerDictionary[feat.properties.id];
        map.setView(marker.getLatLng(), 15);
        marker.fire("click");
      });
      ul.appendChild(li);
    });
  };

  renderList(top5, "top-5-list");
  renderList(worst5, "worst-5-list");
}

function populateTable(features) {
  tableFeatures = [...features].sort((a, b) => b.properties.total_score - a.properties.total_score);
  currentPage = 1;
  renderTablePage();
}

function renderTablePage() {
  const tbody = document.querySelector("#data-table tbody");
  tbody.innerHTML = "";

  const start = (currentPage - 1) * rowsPerPage;
  const end = start + rowsPerPage;
  const paginatedItems = tableFeatures.slice(start, end);

  paginatedItems.forEach((feat) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td>${feat.properties.name}</td>
        <td>${feat.properties.rent_eur} ${!isNaN(feat.properties.rent_eur) ? "EUR" : ""} / ${feat.properties.rent_bgn} ${!isNaN(feat.properties.rent_bgn) ? "BGN" : ""}</td>
        <td>${feat.properties.area} sqm</td>
        <td>${feat.properties.base_score.toFixed(2)}</td>
        <td>${feat.properties.total_score.toFixed(2)}</td>
        <td><a href="${feat.properties.url}" target="_blank">View</a></td>
        <td><button class="focus-table-btn" data-id="${feat.properties.id}">Focus Map</button></td>
    `;
    tbody.appendChild(tr);
  });

  const totalPages = Math.ceil(tableFeatures.length / rowsPerPage) || 1;
  document.getElementById("page-indicator").innerText = `Page ${currentPage} of ${totalPages}`;

  document.getElementById("btn-prev-page").disabled = currentPage === 1;
  document.getElementById("btn-next-page").disabled = end >= tableFeatures.length;

  document.querySelectorAll(".focus-table-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const targetId = parseInt(e.target.getAttribute("data-id"));
      focusOnPropertyFromTable(targetId);
    });
  });
}

function focusOnPropertyFromTable(id) {
  hideModal();
  const marker = markerDictionary[id];
  if (marker) {
    map.setView(marker.getLatLng(), 15);
    marker.fire("click");
  }
}

function showModal() {
  document.getElementById("table-modal").style.display = "block";
}
function hideModal() {
  document.getElementById("table-modal").style.display = "none";
}

async function triggerRecalculation() {
  if (map) {
    map.closePopup();
    isochroneLayer.clearLayers();
    competitorsLayer.clearLayers();
    customPoiLayer.clearLayers();
    rentablePropertiesLayer.clearLayers();
  }

  rentableGeoJSON = await apiFetchRentableObjects();
  renderMapFeatures(rentableGeoJSON);
}

async function apiFetchRentableObjects() {
  showLoading();
  const body = JSON.stringify({
    object_type: currentBusinessType,
    ratings: rating_preferences,
    additional_criteria: Array.from(document.querySelectorAll(".criteria-cb:checked")).map((cb) => {
      return {
        type: cb.getAttribute("value"),
        value: true,
      };
    }),
    custom_poi: activeCustomPoi != "" ? { value: activeCustomPoi, fast: activeCustomPoiFetchMode } : null,
  });

  let response;
  try {
    response = await fetch("/api/scores", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body,
    });
  } catch (err) {
    console.error(err);
    hideLoading();
    return;
  }
  if (!response.ok) {
    hideLoading();
    return;
  }

  const objects_of_same_type_res = await fetch("/api/objects_of_type", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ object_type: currentBusinessType }),
  });
  const objects_of_same_type_json = await objects_of_same_type_res.json();
  fetched_objects_of_same_type = objects_of_same_type_json.objects_of_type;

  if (activeCustomPoi != "") {
    const additional_pois_res = await fetch("/api/objects_of_type", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ object_type: activeCustomPoi }),
    });
    const additional_pois_res_json = await additional_pois_res.json();
    additional_pois = additional_pois_res_json.objects_of_type;
  }

  const response_body = await response.json();
  let id = 0;
  hideLoading();
  return {
    type: "FeatureCollection",
    features: response_body.rentables.map((r) => ({
      type: "Feature",
      geometry: JSON.parse(r.point),
      properties: {
        id: ++id,
        name: r.name,
        address: r.address,
        area: r.area,
        rent_eur: r.rent_eur,
        rent_bgn: r.rent_bgn,
        url: r.url,
        base_score: r.base_score,
        total_score: r.total_score,
        isochrone: r.isochrone,
        parks_in_isochrone: r.parks_in_isochrone,
        schools_in_isochrone: r.schools_in_isochrone,
        public_transport_stops_in_isochrone: r.public_transport_stops_in_isochrone,
      },
    })),
  };
}
