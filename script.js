let entries = JSON.parse(localStorage.getItem("entries") || "[]");
let nextId = entries.length ? Math.max(...entries.map(e => e.id)) + 1 : 1;
let scanCooldown = false;

let videoInputDevices = [];
let currentCameraIndex = 0;

let batches = JSON.parse(localStorage.getItem("batches") || "[]");

// ZXing reader reference
let zxingReader = null;

// Scan mode: "1d", "2d", "all"
let scanMode = localStorage.getItem("scanMode") || "all";

// Load cameras
window.addEventListener("load", async () => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoInputDevices = devices.filter(d => d.kind === "videoinput");

    const savedIndex = localStorage.getItem("lastCameraIndex");
    if (savedIndex !== null) currentCameraIndex = parseInt(savedIndex, 10);

    if (videoInputDevices.length > 0) {
      useCamera(currentCameraIndex);
    } else {
      console.warn("No video input devices found.");
    }
  } catch (err) {
    console.error("Camera init error:", err);
    alert("Camera access is required. Please allow it.");
  }
});

// Toggle camera
function toggleCamera() {
  if (!videoInputDevices.length) {
    alert("No cameras to toggle.");
    return;
  }
  currentCameraIndex = (currentCameraIndex + 1) % videoInputDevices.length;
  localStorage.setItem("lastCameraIndex", currentCameraIndex);
  useCamera(currentCameraIndex);
}

// Switch scan mode
function switchMode(mode) {
  scanMode = mode;
  localStorage.setItem("scanMode", mode);
  stopScanner();
  startScanner();
}

// Start camera
function useCamera(index) {
  stopScanner();

  const deviceId = videoInputDevices[index].deviceId;
  const preview = document.getElementById("cameraPreview");

  // Start preview stream
  navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: deviceId } }
  }).then(stream => {
    preview.srcObject = stream;

    if (scanMode === "2d" || scanMode === "all") {
      try {
        zxingReader = new ZXing.BrowserMultiFormatReader();
        zxingReader.decodeFromVideoDevice(deviceId, preview, (result, err) => {
          if (result && !scanCooldown) {
            const text = result.getText();
            if (text) {
              scanCooldown = true;
              document.getElementById("beepSuccess").play();
              document.getElementById("result").innerText =
                `✅ Scanned (2D): ${text}`;
              saveData(text, 1, 0);
              setTimeout(() => { scanCooldown = false; }, 1000);
            }
          } else if (err && !(err instanceof ZXing.NotFoundException)) {
            console.debug("ZXing err", err);
          }
        });
      } catch (zxErr) {
        console.error("ZXing init error:", zxErr);
      }
    }
  }).catch(err => {
    console.error("Preview error:", err);
  });

  if (scanMode === "1d" || scanMode === "all") {
    Quagga.init({
      inputStream: {
        type: "LiveStream",
        target: document.getElementById("cameraPreview"),
        constraints: { deviceId: deviceId, width: 640, height: 480 }
      },
      decoder: {
        readers: [
          "code_128_reader",
          "ean_reader",
          "ean_8_reader",
          "code_39_reader",
          "code_39_vin_reader",
          "codabar_reader",
          "upc_reader",
          "upc_e_reader",
          "i2of5_reader",
          "2of5_reader",
          "code_93_reader"
        ]
      },
      locate: true
    }, function (err) {
      if (err) {
        console.error("Quagga init failed:", err);
        alert("Camera initialization failed for Quagga.");
        return;
      }
      Quagga.start();
    });

    Quagga.offDetected();
    Quagga.onDetected(data => {
      let code = data.codeResult && data.codeResult.code;
      if (code && !scanCooldown) {
        scanCooldown = true;
        document.getElementById("beepSuccess").play();
        document.getElementById("result").innerText = "✅ Scanned (1D): " + code;
        saveData(code, 1, 0);
        setTimeout(() => { scanCooldown = false; }, 1000);
      } else if (!code) {
        document.getElementById("beepError").play();
      }
    });
  }
}

function stopScanner() {
  try { Quagga.stop(); } catch (e) {}

  try {
    if (zxingReader) {
      try { zxingReader.reset(); } catch (e) { console.warn("zxing reset error", e); }
      zxingReader = null;
    }
  } catch (zxErr) {
    console.warn("ZXing stop error:", zxErr);
  }

  const preview = document.getElementById("cameraPreview");
  if (preview && preview.srcObject) {
    preview.srcObject.getTracks().forEach(track => track.stop());
    preview.srcObject = null;
  }
}
function startScanner() { useCamera(currentCameraIndex); }

// ---------------- Data handling ----------------

function saveData(barcode, qty, price) {
  const existing = entries.find(e => e.barcode === barcode);
  if (existing) {
    existing.quantity += qty;
    if (price > 0) existing.price = price;
  } else {
    entries.push({ id: nextId++, barcode, quantity: qty, price });
  }
  persist();
  renderEntries();
}

function addManualEntry() {
  const barcode = document.getElementById("manualBarcode").value.trim();
  const qty = parseInt(document.getElementById("manualQty").value, 10);
  const price = parseFloat(document.getElementById("manualPrice").value) || 0;
  if (!barcode || qty <= 0) {
    alert("Enter valid barcode and quantity.");
    return;
  }
  saveData(barcode, qty, price);
  document.getElementById("manualBarcode").value = "";
  document.getElementById("manualQty").value = 1;
  document.getElementById("manualPrice").value = "";
}

function editEntry(id) {
  const entry = entries.find(e => e.id === id);
  if (!entry) return;
  const newBarcode = prompt("Edit Barcode:", entry.barcode);
  if (newBarcode === null) return;
  const newQty = parseInt(prompt("Edit Quantity:", entry.quantity), 10);
  const newPrice = parseFloat(prompt("Edit Price:", entry.price)) || 0;
  if (!newBarcode.trim() || isNaN(newQty) || newQty <= 0) return;
  entry.barcode = newBarcode.trim();
  entry.quantity = newQty;
  entry.price = newPrice;
  persist();
  renderEntries();
}

function deleteEntry(id) {
  entries = entries.filter(e => e.id !== id);
  persist();
  renderEntries();
}

function renderEntries() {
  const list = document.getElementById("entriesList");
  list.innerHTML = "";
  entries.forEach(e => {
    const li = document.createElement("li");
    li.textContent = `${e.barcode} - Qty: ${e.quantity} - ₱${e.price.toFixed(2)}`;
    li.onclick = () => editEntry(e.id);

    const delBtn = document.createElement("button");
    delBtn.textContent = "❌";
    delBtn.style.marginLeft = "10px";
    delBtn.onclick = ev => { ev.stopPropagation(); deleteEntry(e.id); };
    li.appendChild(delBtn);

    list.appendChild(li);
  });
}

function nextBatch() {
  if (entries.length === 0) {
    alert("No entries to save for this batch!");
    return;
  }

  const headerData = {
    date: document.getElementById("logDate")?.value || "",
    store: document.getElementById("storeName")?.value || "",
    discount: document.getElementById("discount")?.value || "0"
  };

  batches.push({
    header: headerData,
    entries: JSON.parse(JSON.stringify(entries))
  });
  localStorage.setItem("batches", JSON.stringify(batches));

  document.getElementById("logDate").value = "";
  document.getElementById("storeName").value = "";
  document.getElementById("discount").value = "0";
  entries = [];
  nextId = 1;
  persist();
  renderEntries();
  renderBatches();

  document.getElementById("result").textContent = `✅ Batch ${batches.length} saved. Ready for next batch.`;
}

function downloadExcel() {
  if (entries.length > 0) {
    if (confirm("Save current entries as a batch before export?")) {
      nextBatch();
    }
  }

  if (batches.length === 0) {
    alert("No data to export!");
    return;
  }

  let wsData = [];
  batches.forEach((batch, i) => {
    wsData.push([`Batch ${i + 1}`]);
    wsData.push(["Date", batch.header.date]);
    wsData.push(["Store", batch.header.store]);
    wsData.push(["Discount", batch.header.discount + "%"]);
    wsData.push([]);
    wsData.push(["Barcode", "Quantity", "Price"]);
    batch.entries.forEach(e => {
      wsData.push([e.barcode, e.quantity, e.price]);
    });
    wsData.push([]);
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Logsheet");
  XLSX.writeFile(wb, "logsheet.xlsx");
}

function clearHistory() {
  if (confirm("Clear all entries and batches?")) {
    entries = [];
    batches = [];
    nextId = 1;
    persist();
    localStorage.removeItem("batches");
    renderEntries();
    renderBatches();
  }
}

function persist() {
  localStorage.setItem("entries", JSON.stringify(entries));
}

// --- Header persistence ---
function saveHeaderToStorage() {
  const headerData = {
    date: document.getElementById("logDate")?.value || "",
    store: document.getElementById("storeName")?.value || "",
    discount: document.getElementById("discount")?.value || "0"
  };
  localStorage.setItem("headerData", JSON.stringify(headerData));
}

function loadHeaderFromStorage() {
  const headerData = JSON.parse(localStorage.getItem("headerData") || "{}");
  if (headerData.date) document.getElementById("logDate").value = headerData.date;
  if (headerData.store) document.getElementById("storeName").value = headerData.store;
  if (headerData.discount) document.getElementById("discount").value = headerData.discount;

  ["logDate","storeName","discount"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", saveHeaderToStorage);
  });
}

function renderBatches() {
  const list = document.getElementById("batchesList");
  list.innerHTML = "";

  batches.forEach((batch, i) => {
    const li = document.createElement("li");
    li.style.marginBottom = "10px";

    const totalQty = batch.entries.reduce((sum, e) => sum + e.quantity, 0);
    li.innerHTML = `
      <div style="cursor:pointer; font-weight:bold;">
        📦 Batch ${i + 1}: ${batch.header.date || "No Date"} | ${batch.header.store || "No Store"} | Discount: ${batch.header.discount}% | Items: ${batch.entries.length}, Total Qty: ${totalQty}
      </div>
    `;

    const delBtn = document.createElement("button");
    delBtn.textContent = "❌ Delete";
    delBtn.onclick = () => {
      if (confirm(`Delete Batch ${i + 1}?`)) {
        batches.splice(i, 1);
        localStorage.setItem("batches", JSON.stringify(batches));
        renderBatches();
      }
    };

    li.appendChild(delBtn);
    list.appendChild(li);
  });
}

// Initial render
renderEntries();
renderBatches();
