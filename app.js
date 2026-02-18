
(() => {
  "use strict";

  const STORAGE_KEY = "wow_timesheet_v4";

  /** @typedef {{type:string,start:number,end:number|null}} Break */
  /** @typedef {{id:string,event:string,name:string,date:string,start:number,end:number|null,breaks:Break[],signatureDataUrl:string|null}} Shift */

  /** @type {{shifts: Shift[]}} */
  let state = loadState();

  // -------- helpers --------
  const $ = (id) => document.getElementById(id);

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return {shifts: []};
      const parsed = JSON.parse(raw);
      if(!parsed || !Array.isArray(parsed.shifts)) return {shifts: []};
      return parsed;
    }catch{
      return {shifts: []};
    }
  }
  function saveState(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function pad2(n){ return String(n).padStart(2, "0"); }
  function nowTimeHHMM(){
    const d = new Date();
    const mins = d.getHours()*60 + d.getMinutes();
    const q = Math.round(mins/15)*15;
    const hh = Math.floor(q/60) % 24;
    const mm = q % 60;
    return `${pad2(hh)}:${pad2(mm)}`;
  }
  function niceTime(ms){
    const d = new Date(ms);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function uuid(){
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function msToMins(ms){ return Math.max(0, Math.round(ms / 60000)); }
  function escapeCsv(v){
    const s = (v ?? "").toString();
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function escapeHtml(s){
    return (s ?? "").toString()
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function activeShifts(){ return state.shifts.filter(s => !s.end); }
  function completedShifts(){ return state.shifts.filter(s => !!s.end); }

  function activeBreak(shift){ return shift.breaks.find(b => b.end === null) || null; }

  function breakMinutes(shift){
    return shift.breaks.reduce((sum, b) => {
      if(b.end === null) return sum;
      return sum + msToMins(b.end - b.start);
    }, 0);
  }
  function totalMinutes(shift){
    if(!shift.end) return null;
    return msToMins(shift.end - shift.start);
  }
  function workedMinutes(shift){
    if(!shift.end) return null;
    return Math.max(0, totalMinutes(shift) - breakMinutes(shift));
  }

  // -------- tabs --------
  const tabActive = $("tabActive");
  const tabHistory = $("tabHistory");
  const tabExport = $("tabExport");

  const viewActive = $("viewActive");
  const viewHistory = $("viewHistory");
  const viewExport = $("viewExport");

  function setTab(which){
    for(const [tab, view] of [
      [tabActive, viewActive],
      [tabHistory, viewHistory],
      [tabExport, viewExport]
    ]){
      const on = (tab === which);
      tab.classList.toggle("active", on);
      view.hidden = !on;
    }
    if(which === tabHistory) renderHistory();
  }

  tabActive.addEventListener("click", ()=>setTab(tabActive));
  tabHistory.addEventListener("click", ()=>setTab(tabHistory));
  tabExport.addEventListener("click", ()=>setTab(tabExport));

  // -------- active view inputs --------
  const eventInput = $("eventName");
  const nameInput  = $("staffName");
  const dateInput  = $("shiftDate");
  const timeInput  = $("shiftStart");

  const startBtn = $("startShift");
  const clearBtn = $("clearInputs");

  const activeWrap = $("activeShifts");
  const noActive = $("noActive");
  const activeCount = $("activeCount");

  dateInput.valueAsDate = new Date();
  timeInput.value = nowTimeHHMM();

  startBtn.addEventListener("click", () => {
    const event = (eventInput.value || "").trim();
    const name  = (nameInput.value || "").trim();
    const date  = (dateInput.value || "").trim();
    const time  = (timeInput.value || "").trim();

    if(!event || !name || !date){
      alert("Please enter event name, staff name, and date.");
      return;
    }
    if(!/^\d{2}:\d{2}$/.test(time)){
      alert("Start time must be HH:MM.");
      return;
    }

    const [hh, mm] = time.split(":").map(Number);
    const [y, m, d] = date.split("-").map(Number);
    const start = new Date(y, m - 1, d, hh, mm, 0, 0).getTime();

    /** @type {Shift} */
    const shift = {
      id: uuid(),
      event,
      name,
      date,
      start,
      end: null,
      breaks: [],
      signatureDataUrl: null
    };

    state.shifts.push(shift);
    saveState();
    renderActive();

    nameInput.value = "";
    timeInput.value = nowTimeHHMM();
  });

  clearBtn.addEventListener("click", () => {
    eventInput.value = "";
    nameInput.value = "";
    dateInput.valueAsDate = new Date();
    timeInput.value = nowTimeHHMM();
  });

  // -------- signature modal --------
  const sigDialog = $("sigDialog");
  const sigCanvas = $("sigCanvas");
  const sigClear = $("sigClear");
  const sigSave = $("sigSave");
  const sigCancel = $("sigCancel");
  const sigEndTime = $("sigEndTime");

  const sigCtx = sigCanvas.getContext("2d");
  let sigDrawing = false;
  let sigEmpty = true;
  /** @type {Shift|null} */
  let sigTargetShift = null;

  function sigResizeToCss(){
    // Keep internal canvas resolution high for iPad, but match CSS size
    const rect = sigCanvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);
    if(sigCanvas.width !== w || sigCanvas.height !== h){
      sigCanvas.width = w;
      sigCanvas.height = h;
      sigCtx.scale(dpr, dpr);
      sigCtx.lineWidth = 3;
      sigCtx.lineCap = "round";
      sigCtx.strokeStyle = "#0f172a";
      clearSignature();
    }
  }

  function clearSignature(){
    const rect = sigCanvas.getBoundingClientRect();
    sigCtx.clearRect(0, 0, rect.width, rect.height);
    sigCtx.fillStyle = "#ffffff";
    sigCtx.fillRect(0, 0, rect.width, rect.height);
    sigEmpty = true;
  }

  function getPos(e){
    const rect = sigCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  sigCanvas.addEventListener("pointerdown", (e)=>{
    sigCanvas.setPointerCapture(e.pointerId);
    sigDrawing = true;
    const p = getPos(e);
    sigCtx.beginPath();
    sigCtx.moveTo(p.x, p.y);
    sigEmpty = false;
  });
  sigCanvas.addEventListener("pointermove", (e)=>{
    if(!sigDrawing) return;
    const p = getPos(e);
    sigCtx.lineTo(p.x, p.y);
    sigCtx.stroke();
  });
  sigCanvas.addEventListener("pointerup", ()=>{ sigDrawing = false; });
  sigCanvas.addEventListener("pointercancel", ()=>{ sigDrawing = false; });

  sigClear.addEventListener("click", ()=>clearSignature());

  sigDialog.addEventListener("close", ()=>{
    // handle via returnValue
    const rv = sigDialog.returnValue;
    if(rv === "save" && sigTargetShift){
      applyEndTimeFromInput(sigTargetShift);
      if(sigEmpty){
        if(!confirm("No signature detected. Save shift without signature?")){
          // reopen
          sigDialog.showModal();
          return;
        }
        sigTargetShift.signatureDataUrl = null;
      }else{
        // export at CSS size (not internal)
        const rect = sigCanvas.getBoundingClientRect();
        const temp = document.createElement("canvas");
        temp.width = Math.floor(rect.width);
        temp.height = Math.floor(rect.height);
        const tctx = temp.getContext("2d");
        tctx.drawImage(sigCanvas, 0, 0, rect.width, rect.height, 0, 0, rect.width, rect.height);
        sigTargetShift.signatureDataUrl = temp.toDataURL("image/png");
      }
      saveState();
      renderActive();
    }else if(rv === "cancel" && sigTargetShift){
      applyEndTimeFromInput(sigTargetShift);
      // keep shift ended but no signature
      sigTargetShift.signatureDataUrl = null;
      saveState();
      renderActive();
    }
    sigTargetShift = null;
  });


  function applyEndTimeFromInput(shift){
    const t = (sigEndTime?.value || "").trim();
    if(!shift || !shift.date || !/^\d{2}:\d{2}$/.test(t)) return;
    const [hh, mm] = t.split(":").map(Number);
    const [y, m, d] = shift.date.split("-").map(Number);
    const endMs = new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
    if(endMs < shift.start){
      alert("End time cannot be before start time.");
      return;
    }
    shift.end = endMs;
  }

  function openSignatureFor(shift){
    sigTargetShift = shift;
    sigDialog.returnValue = "";

    // Prefill end time to nearest quarter hour
    try{
      const base = new Date(shift.end || Date.now());
      const mins = base.getHours()*60 + base.getMinutes();
      const q = Math.round(mins/15)*15;
      const hh = Math.floor(q/60) % 24;
      const mm = q % 60;
      sigEndTime.value = `${pad2(hh)}:${pad2(mm)}`;
    }catch{ sigEndTime.value = nowTimeHHMM(); }

    // Ensure canvas matches CSS size
    setTimeout(()=>{
      sigResizeToCss();
      clearSignature();
    }, 0);
    sigDialog.showModal();
  }

  // -------- active rendering --------
  function renderActive(){
    const active = activeShifts();
    activeCount.textContent = String(active.length);
    activeWrap.innerHTML = "";
    noActive.style.display = active.length ? "none" : "block";

    for(const shift of active){
      const card = document.createElement("div");
      card.className = "shift";

      const ab = activeBreak(shift);

      card.innerHTML = `
        <div class="top">
          <div>
            <span class="badge">${escapeHtml(shift.event)}</span>
            <span class="badge">${escapeHtml(shift.date)}</span>
            <div style="margin-top:6px"><strong>${escapeHtml(shift.name)}</strong></div>
            <div class="small">Start: ${niceTime(shift.start)}${ab ? ` · Break running: ${escapeHtml(ab.type)} since ${niceTime(ab.start)}` : ""}</div>
          </div>
          <div class="small">Break minutes so far: ${breakMinutes(shift)}</div>
        </div>

        <div class="inline">
          <label class="field">
            <span>Break type</span>
            <select data-break-type>
              <option value="10 min">10 min</option>
              <option value="30 min">30 min</option>
            </select>
          </label>

          <button class="btn ${ab ? "" : "ok"}" data-start-break ${ab ? "disabled" : ""} type="button">Start break</button>
          <button class="btn ${ab ? "ok" : ""}" data-end-break ${ab ? "" : "disabled"} type="button">End break</button>
          <button class="btn danger" data-end-shift type="button">End shift + sign</button>
        </div>
      `;

      const sel = card.querySelector("[data-break-type]");
      const startB = card.querySelector("[data-start-break]");
      const endB = card.querySelector("[data-end-break]");
      const endS = card.querySelector("[data-end-shift]");

      startB.addEventListener("click", () => {
        if(activeBreak(shift)){
          alert("A break is already running for this shift.");
          return;
        }
        const type = sel.value;
        shift.breaks.push({type, start: Date.now(), end: null});
        saveState();
        renderActive();
      });

      endB.addEventListener("click", () => {
        const b = activeBreak(shift);
        if(!b){
          alert("No running break found.");
          return;
        }
        b.end = Date.now();
        saveState();
        renderActive();
      });

      endS.addEventListener("click", () => {
        if(activeBreak(shift)){
          alert("End the running break first.");
          return;
        }
        if(!confirm(`End shift for ${shift.name} and capture signature now?`)) return;
        shift.end = Date.now();
        saveState();
        renderActive();
        // jump to signature
        openSignatureFor(shift);
      });

      activeWrap.appendChild(card);
    }

    // also update history count pill without switching tab
    $("historyCount").textContent = String(completedShifts().length);
    $("noHistory").style.display = completedShifts().length ? "none" : "block";
  }

  // -------- history --------
  const historyList = $("historyList");
  const historySearch = $("historySearch");
  const historyDate = $("historyDate");
  const historyClear = $("historyClear");
  const historyCount = $("historyCount");
  const noHistory = $("noHistory");

  const detailDialog = $("detailDialog");
  const detailBody = $("detailBody");
  const detailDelete = $("detailDelete");
  const detailDownloadSig = $("detailDownloadSig");
  /** @type {string|null} */
  let detailShiftId = null;

  historySearch.addEventListener("input", renderHistory);
  historyDate.addEventListener("change", renderHistory);
  historyClear.addEventListener("click", ()=>{
    historySearch.value = "";
    historyDate.value = "";
    renderHistory();
  });

  detailDialog.addEventListener("close", ()=>{
    const rv = detailDialog.returnValue;

    if(rv === "downloadSig" && detailShiftId){
      const s = state.shifts.find(x => x.id === detailShiftId);
      if(s && s.signatureDataUrl){
        const a = document.createElement("a");
        a.href = s.signatureDataUrl;
        const safeName = (s.name || "staff").replace(/[^a-z0-9\-\_\s]/gi,"").trim().replace(/\s+/g,"-");
        const safeEvent = (s.event || "event").replace(/[^a-z0-9\-\_\s]/gi,"").trim().replace(/\s+/g,"-");
        a.download = `Signature-${safeEvent}-${safeName}-${s.date}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }else{
        alert("No signature saved for this shift.");
      }
      setTimeout(()=>{ if(detailShiftId){ openDetail(detailShiftId); } }, 0);
      return;
    }

    if(rv === "delete" && detailShiftId){
      if(confirm("Delete this shift? This cannot be undone.")){
        state.shifts = state.shifts.filter(s => s.id !== detailShiftId);
        saveState();
        detailShiftId = null;
        renderHistory();
        renderActive();
        return;
      }
    }
    detailShiftId = null;
  });


  function renderHistory(){
    const search = (historySearch.value || "").trim().toLowerCase();
    const date = (historyDate.value || "").trim();

    const items = completedShifts().filter(s => {
      if(date && s.date !== date) return false;
      if(search){
        const hay = `${s.name} ${s.event}`.toLowerCase();
        if(!hay.includes(search)) return false;
      }
      return true;
    }).sort((a,b) => (b.end - a.end));

    historyCount.textContent = String(items.length);
    historyList.innerHTML = "";
    noHistory.style.display = items.length ? "none" : "block";

    for(const s of items){
      const div = document.createElement("div");
      div.className = "shift";
      div.innerHTML = `
        <div class="top">
          <div>
            <span class="badge">${escapeHtml(s.event)}</span>
            <span class="badge">${escapeHtml(s.date)}</span>
            <div style="margin-top:6px"><strong>${escapeHtml(s.name)}</strong></div>
            <div class="small">Start: ${niceTime(s.start)} · End: ${niceTime(s.end)} · Worked: ${workedMinutes(s)} min</div>
            <div class="small">Signature: ${s.signatureDataUrl ? "Yes" : "No"}</div>
          </div>
          <div class="actions" style="margin:0">
            <button class="btn" data-view type="button">View</button>
          </div>
        </div>
      `;

      div.querySelector("[data-view]").addEventListener("click", ()=>openDetail(s.id));
      historyList.appendChild(div);
    }
  }

  function openDetail(id){
    const s = state.shifts.find(x => x.id === id);
    if(!s) return;
    detailShiftId = id;

    const breaksField = s.breaks
      .filter(b=>b.end!==null)
      .map(b => {
        const mins = msToMins(b.end - b.start);
        return `<li>${escapeHtml(b.type)}: ${niceTime(b.start)} to ${niceTime(b.end)} (${mins} min)</li>`;
      }).join("");

    const sigHtml = s.signatureDataUrl
      ? `<div class="small"><strong>Signature</strong></div><img alt="Signature" src="${s.signatureDataUrl}">`
      : `<div class="small"><strong>Signature</strong>: No</div>`;

    detailBody.innerHTML = `
      <div class="small"><span class="badge">${escapeHtml(s.event)}</span> <span class="badge">${escapeHtml(s.date)}</span></div>
      <div style="margin-top:6px"><strong>${escapeHtml(s.name)}</strong></div>
      <div class="small">Start: ${niceTime(s.start)} · End: ${niceTime(s.end)}</div>
      <div class="small">Total minutes: ${totalMinutes(s)} · Break minutes: ${breakMinutes(s)} · Worked minutes: ${workedMinutes(s)}</div>
      <div class="small" style="margin-top:10px"><strong>Breaks</strong></div>
      ${breaksField ? `<ul>${breaksField}</ul>` : `<div class="muted">No breaks recorded.</div>`}
      <div style="margin-top:10px">${sigHtml}</div>
    `;

    try{ detailDownloadSig.disabled = !s.signatureDataUrl; }catch{}
    detailDialog.showModal();
  }

  // -------- export --------
  const exportEvent = $("exportEvent");
  const exportFrom = $("exportFrom");
  const exportTo = $("exportTo");
  const exportBtn = $("exportCSV");
  const exportSignatures = $("exportSignatures");

  exportBtn.addEventListener("click", () => {
    const ev = (exportEvent.value || "").trim().toLowerCase();
    const from = (exportFrom.value || "").trim();
    const to = (exportTo.value || "").trim();

    const rows = [];
    rows.push([
      "EntryID","Event","Date","Name",
      "ShiftStart","ShiftEnd",
      "TotalShiftMinutes","BreakMinutes","WorkedMinutes",
      "BreakCount","Breaks",
      "SignatureCaptured"
    ].join(","));

    const filtered = completedShifts().filter(s => {
      if(ev && s.event.toLowerCase() !== ev) return false;
      if(from && s.date < from) return false;
      if(to && s.date > to) return false;
      return true;
    }).sort((a,b) => (a.start - b.start));

    for(const s of filtered){
      const breaksField = s.breaks
        .filter(b => b.end !== null)
        .map(b => `${b.type}|${new Date(b.start).toISOString()}|${new Date(b.end).toISOString()}|${msToMins(b.end-b.start)}`)
        .join("; ");

      rows.push([
        s.id,
        s.event,
        s.date,
        s.name,
        new Date(s.start).toISOString(),
        new Date(s.end).toISOString(),
        totalMinutes(s),
        breakMinutes(s),
        workedMinutes(s),
        s.breaks.filter(b=>b.end!==null).length,
        breaksField,
        s.signatureDataUrl ? "Yes" : "No"
      ].map(escapeCsv).join(","));
    }

    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    downloadText(`Timesheets-${stamp}.csv`, rows.join("\n"));
  });

  function downloadText(filename, text){
    const blob = new Blob([text], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 800);
  }

  // init
  renderActive();
  renderHistory();
})();

  exportSignatures?.addEventListener("click", ()=>{
    const signed = completedShifts().filter(s => s.signatureDataUrl);
    if(!signed.length){
      alert("No signatures available to export.");
      return;
    }

    const padding = 20;
    const lineHeight = 24;
    const sigWidth = 800;
    const sigHeight = 220;

    const totalHeight = signed.length * (sigHeight + lineHeight*3 + padding*2);
    const canvas = document.createElement("canvas");
    canvas.width = sigWidth + padding*2;
    canvas.height = totalHeight;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.fillStyle = "#000000";
    ctx.font = "18px system-ui, sans-serif";

    let y = padding;

    signed.forEach(s => {
      ctx.fillText(`${s.name} | ${s.event} | ${s.date}`, padding, y + lineHeight);
      ctx.fillText(`Worked minutes: ${workedMinutes(s)}`, padding, y + lineHeight*2);

      const img = new Image();
      img.src = s.signatureDataUrl;
      ctx.drawImage(img, padding, y + lineHeight*3, sigWidth, sigHeight);

      y += sigHeight + lineHeight*3 + padding*2;
    });

    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    a.download = `All-Signatures-${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
