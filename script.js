// ------------------- Globals -------------------
let entries = JSON.parse(localStorage.getItem("entries") || "[]");
let batches = JSON.parse(localStorage.getItem("batches") || "[]");
let nextId = entries.length ? Math.max(...entries.map(e => e.id)) + 1 : 1;

let videoInputDevices = [];
let currentCameraIndex = 0;
let currentScanMode = localStorage.getItem("scanMode") || "all";
let codeReader = null;

// ------------------- Scan Mode Control -------------------
function switchMode(mode) {
  currentScanMode = mode;
  localStorage.setItem("scanMode", mode);
  stopScanner();
  startScanner();
}

// ------------------- Scanner Start/Stop -------------------
async function startScanner() {
  stopScanner(); // ensure clean restart

  videoInputDevices = await navigator.mediaDevices.enumerateDevices()
    .then(devices => devices.filter(d => d.kind === "videoinput"));

  const constraints = {
    video: {
      deviceId: videoInputDevices[currentCameraIndex]?.deviceId || undefined,
      facingMode: "environment"
    }
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const videoElement = document.getElementById("cameraPreview");
  videoElement.srcObject = stream;

  // ZXing for 2D/All
  if (currentScanMode === "2d" || currentScanMode === "all") {
    codeReader = new ZXing.BrowserMultiFormatReader();
    codeReader.decodeFromVideoDevice(
      videoInputDevices[currentCameraIndex]?.deviceId || null,
      "cameraPreview",
      (result, err) => {
        if (result) {
          handleScannedCode(result.getText());
        }
      }
    );
  }

  // Quagga for 1D/All
  if (currentScanMode === "1d" || currentScanMode === "all") {
    Quagga.init({
      inputStream: {
        type: "LiveStream",
        target: videoElement,
        constraints: constraints.video
      },
      decoder: {
        readers: ["code_128_reader", "ean_reader", "ean_8_reader", "upc_reader", "upc_e_reader"]
      }
    }, err => {
      if (!err) {
        Quagga.start();
        Quagga.onDetected(data => {
          handleScannedCode(data.codeResult.code);
        });
      }
    });
  }
}

function stopScanner() {
  // Stop Quagga
  if (Quagga.running) {
    Quagga.stop();
  }

  // Stop ZXing
  if (codeReader) {
    codeReader.reset();
    codeReader = null;
  }

  // Stop video stream
  const videoElement = document.getElementById("cameraPreview");
  if (videoElement.srcObject) {
    videoElement.srcObject.getTracks().forEach(track => track.stop());
    videoElement.srcObject = null;
  }
}

// ------------------- Camera Toggle -------------------
function toggleCamera() {
  if (videoInputDevices.length > 1) {
    currentCameraIndex = (currentCameraIndex + 1) % videoInputDevices.length;
    startScanner();
  } else {
    alert("No secondary camera found!");
  }
}

// ------------------- Entry Management -------------------
function handleScannedCode(code) {
  const beepSuccess = document.getElementById("beepSuccess");
  const beepError = document.getElementById("beepError");
  const existing = entries.find(e => e.barcode === code);

  if (existing) {
    existing.quantity += 1;
    beepSuccess.play();
  } else {
    entries.push({ id: nextId++, barcode: code, quantity: 1, price: 0 });
    beepSuccess.play();
  }
  localStorage.setItem("entries", JSON.stringify(entries));
  renderEntries();
  document.getElementById("result").textContent = `Scanned: ${code}`;
}

function addManualEntry() {
  const barcode = document.getElementById("manualBarcode").value.trim();
  const qty = parseInt(document.getElementById("manualQty").value) || 1;
  const price = parseFloat(document.getElementById("manualPrice").value) || 0;

  if (!barcode) return;

  entries.push({ id: nextId++, barcode, quantity: qty, price });
  localStorage.setItem("entries", JSON.stringify(entries));
  renderEntries();

  document.getElementById("manualBarcode").value = "";
  document.getElementById("manualQty").value = 1;
  document.getElementById("manualPrice").value = "";
}

function renderEntries() {
  const list = document.getElementById("entriesList");
  list.innerHTML = "";
  entries.forEach(e => {
    const li = document.createElement("li");
    li.textContent = `${e.barcode} | Qty: ${e.quantity} | Price: ${e.price}`;
    list.appendChild(li);
  });
}

function clearHistory() {
  if (confirm("Clear all entries?")) {
    entries = [];
    localStorage.setItem("entries", "[]");
    renderEntries();
  }
}

// ------------------- Batch Management -------------------
function nextBatch() {
  if (entries.length === 0) return alert("No entries to save!");

  const header = {
    date: localStorage.getItem("batchDate") || "",
    store: localStorage.getItem("batchStore") || "",
    discount: localStorage.getItem("batchDiscount") || "0"
  };

  batches.push({ header, entries });
  localStorage.setItem("batches", JSON.stringify(batches));

  entries = [];
  localStorage.setItem("entries", "[]");
  renderEntries();
  renderBatches();
}

function renderBatches() {
  const list = document.getElementById("batchesList");
  list.innerHTML = "";
  batches.forEach((batch, i) => {
    const totalQty = batch.entries.reduce((sum, e) => sum + e.quantity, 0);
    const li = document.createElement("li");
    li.innerHTML =
      `<strong>Batch ${i + 1}</strong> - ${batch.header.date} - ${batch.header.store} - Discount: ${batch.header.discount}% - Total Qty: ${totalQty}`;

    const exportBtn = document.createElement("button");
    exportBtn.textContent = "💾 Export";
    exportBtn.onclick = () => exportSingleBatch(batch, i + 1);
    li.appendChild(exportBtn);

    const delBtn = document.createElement("button");
    delBtn.textContent = "🗑️ Delete";
    delBtn.onclick = () => {
      if (confirm("Delete this batch?")) {
        batches.splice(i, 1);
        localStorage.setItem("batches", JSON.stringify(batches));
        renderBatches();
      }
    };
    li.appendChild(delBtn);

    list.appendChild(li);
  });
}

function exportSingleBatch(batch, index) {
  let wsData = [];
  wsData.push([`Batch ${index}`]);
  wsData.push(["Date", batch.header.date]);
  wsData.push(["Store", batch.header.store]);
  wsData.push(["Discount", batch.header.discount + "%"]);
  wsData.push([]);
  wsData.push(["Barcode", "Quantity", "Price"]);
  batch.entries.forEach(e => {
    wsData.push([e.barcode, e.quantity, e.price]);
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Batch ${index}`);
  XLSX.writeFile(wb, `batch_${index}.xlsx`);
}

// ------------------- Excel Export -------------------
function downloadExcel() {
  let wsData = [["Barcode", "Quantity", "Price"]];
  entries.forEach(e => wsData.push([e.barcode, e.quantity, e.price]));

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Entries");
  XLSX.writeFile(wb, "entries.xlsx");
}

// ------------------- Init -------------------
renderEntries();
renderBatches();
startScanner();
