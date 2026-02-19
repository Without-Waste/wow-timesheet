
(() => {
  "use strict";

  const STORAGE_KEY = "wow_timesheet_v7_fixedbreaks";

  /** @typedef {{type:string, minutes:number}} Break */
  /** @typedef {{id:string,event:string,name:string,date:string,start:number,end:number|null,breaks:Break[],signatureDataUrl:string|null}} Shift */
  /** @type {{shifts: Shift[]}} */
  let state = loadState();

  const $ = (id) => document.getElementById(id);

  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return {shifts: []};
      const parsed = JSON.parse(raw);
      if(!parsed || !Array.isArray(parsed.shifts)) return {shifts: []};
      // migrate breaks from older timer style
      parsed.shifts.forEach(s => {
        if(Array.isArray(s.breaks)){
          s.breaks = s.breaks.map(b => {
            if(b && typeof b.minutes === "number") return b;
            if(b && typeof b.start === "number" && typeof b.end === "number"){
              const mins = Math.max(0, Math.round((b.end - b.start)/60000));
              return {type: b.type || "Break", minutes: mins};
            }
            return {type: (b && b.type) ? b.type : "Break", minutes: 0};
          });
        } else {
          s.breaks = [];
        }
      });
      return parsed;
    }catch{
      return {shifts: []};
    }
  }
  function saveState(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function pad2(n){ return String(n).padStart(2, "0"); }

  function localISODateFromMs(ms){
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = pad2(d.getMonth()+1);
    const day = pad2(d.getDate());
    return `${y}-${m}-${day}`;
  }

  function format12hFromMsLocal(ms){
    const d = new Date(ms);
    const H = d.getHours();
    const M = d.getMinutes();
    const ampm = H >= 12 ? "pm" : "am";
    const h12 = ((H + 11) % 12) + 1;
    return `${h12}:${pad2(M)} ${ampm}`;
  }


  function todayISO(){
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  }

  function nearestQuarter(){
    const d = new Date();
    const total = d.getHours()*60 + d.getMinutes();
    let rounded = Math.round(total/15)*15;
    if(rounded >= 1440) rounded = 0;
    const hh = Math.floor(rounded/60);
    const mm = rounded % 60;
    return `${pad2(hh)}:${pad2(mm)}`;
  }


  function buildQuarterHourOptionsHtml(){
    let out = "";
    for(let h=0; h<24; h++){
      for(let m=0; m<60; m+=15){
        const t = `${pad2(h)}:${pad2(m)}`;
        out += `<option value="${t}">${t}</option>`;
      }
    }
    out += `<option value="CUSTOM">Custom…</option>`;
    return out;
  }


  function nowTimeHHMMRounded(){ return nearestQuarter(); }


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

  function breakMinutes(shift){
    return (shift.breaks || []).reduce((sum,b)=>sum + (Number(b.minutes)||0), 0);
  }
  function totalMinutes(shift){
    if(!shift.end) return null;
    return msToMins(shift.end - shift.start);
  }
  function workedMinutes(shift){
    if(!shift.end) return null;
    return Math.max(0, totalMinutes(shift) - breakMinutes(shift));
  }

  function setShiftTimeFromHHMM(shift, field, hhmm){
    if(!shift || !shift.date || !/^\d{2}:\d{2}$/.test(hhmm)) return false;
    const [hh, mm] = hhmm.split(":").map(Number);
    const [y, m, d] = shift.date.split("-").map(Number);
    const ms = new Date(y, m-1, d, hh, mm, 0, 0).getTime();
    if(field === "start") shift.start = ms;
    if(field === "end") shift.end = ms;
    return true;
  }

  // ---- tabs ----
  const tabActive = $("tabActive");
  const tabHistory = $("tabHistory");
  const tabExport = $("tabExport");
  const viewActive = $("viewActive");
  const viewHistory = $("viewHistory");
  const viewExport = $("viewExport");

  function setTab(which){
    for(const [tab, view] of [[tabActive,viewActive],[tabHistory,viewHistory],[tabExport,viewExport]]){
      const on = (tab === which);
      tab.classList.toggle("active", on);
      view.hidden = !on;
    }
    if(which === tabHistory) renderHistory();
  }
  tabActive.addEventListener("click", ()=>setTab(tabActive));
  tabHistory.addEventListener("click", ()=>setTab(tabHistory));
  tabExport.addEventListener("click", ()=>setTab(tabExport));

  // ---- start shift form ----
  const eventInput = $("eventName");
  const nameInput  = $("staffName");
  const dateInput  = $("shiftDate");
  const timeInput  = $("shiftStart");
  
  function applyDefaults(){
    if(!dateInput.value) dateInput.value = todayISO();
    if(!timeInput.value) timeInput.value = nearestQuarter();
  }
  applyDefaults();
  window.addEventListener("pageshow", applyDefaults);
  document.addEventListener("visibilitychange", ()=>{
    if(document.visibilityState === "visible") applyDefaults();
  });
const startBtn = $("startShift");
  const clearBtn = $("clearInputs");

  dateInput.value = todayISO();
  timeInput.value = nearestQuarter();

  startBtn.addEventListener("click", ()=>{
    const event = (eventInput.value || "").trim();
    const name = (nameInput.value || "").trim();
    const date = (dateInput.value || "").trim();
    const time = (timeInput.value || "").trim();

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
    const start = new Date(y, m-1, d, hh, mm, 0, 0).getTime();

    /** @type {Shift} */
    const shift = {id: uuid(), event, name, date, start, end: null, breaks: [], signatureDataUrl: null};
    state.shifts.push(shift);
    saveState();
    renderActive();

    nameInput.value = "";
    timeInput.value = nearestQuarter();
  });

  clearBtn.addEventListener("click", ()=>{
    eventInput.value = "";
    nameInput.value = "";
    dateInput.value = todayISO();
    timeInput.value = nearestQuarter();
  });

  // ---- active render ----
  const activeWrap = $("activeShifts");
  const noActive = $("noActive");
  const activeCount = $("activeCount");

  function renderActive(){
    const active = activeShifts();
    activeCount.textContent = String(active.length);
    activeWrap.innerHTML = "";
    noActive.style.display = active.length ? "none" : "block";

    for(const shift of active){
      const card = document.createElement("div");
      card.className = "shift";

      const breaksHtml = (shift.breaks||[]).map((b, idx)=>{
        return `
          <div class="breakRow">
            <div class="label">${escapeHtml(b.type)}</div>
            <label class="field" style="margin:0">
              <span>Minutes</span>
              <input data-bmins="${idx}" type="number" min="0" step="1" value="${Number(b.minutes)||0}">
            </label>
            <button class="btn mini danger" data-bdel="${idx}" type="button">Remove</button>
          </div>
        `;
      }).join("");

      card.innerHTML = `
        <div class="top">
          <div>
            <span class="badge">${escapeHtml(shift.event)}</span>
            <span class="badge">${escapeHtml(shift.date)}</span>
            <div style="margin-top:6px"><strong>${escapeHtml(shift.name)}</strong></div>
            <div class="small">Start: ${niceTime(shift.start)}</div>
          </div>
          <div class="small">Break minutes: ${breakMinutes(shift)}</div>
        </div>

        <div class="breakAdd">
          <button class="btn ok" data-add10 type="button">+ 10 min break</button>
          <button class="btn ok" data-add30 type="button">+ 30 min break</button>

          <label class="field" style="min-width:180px">
            <span>Custom break minutes</span>
            <input data-custom type="number" min="0" step="1" placeholder="e.g. 45">
          </label>
          <button class="btn ok" data-addcustom type="button">Add custom break</button>

          <button class="btn danger" data-endshift type="button">End shift + sign</button>
        </div>

        <div class="breakList">
          <div class="small"><strong>Breaks</strong> (editable)</div>
          ${breaksHtml || `<div class="muted" style="margin-top:8px">No breaks yet.</div>`}
        </div>
      `;

      // add break handlers
      card.querySelector("[data-add10]").addEventListener("click", ()=>{
        shift.breaks.push({type:"10 min", minutes:10});
        saveState();
        renderActive();
      });
      card.querySelector("[data-add30]").addEventListener("click", ()=>{
        shift.breaks.push({type:"30 min", minutes:30});
        saveState();
        renderActive();
      });
      card.querySelector("[data-addcustom]").addEventListener("click", ()=>{
        const inp = card.querySelector("[data-custom]");
        const v = Number(inp.value);
        if(!Number.isFinite(v) || v <= 0){
          alert("Enter a custom break in minutes (e.g. 45).");
          return;
        }
        shift.breaks.push({type:"Custom", minutes: Math.round(v)});
        inp.value = "";
        saveState();
        renderActive();
      });

      // edit/remove breaks
      card.querySelectorAll("[data-bmins]").forEach(el=>{
        el.addEventListener("change", ()=>{
          const idx = Number(el.getAttribute("data-bmins"));
          const v = Math.max(0, Math.round(Number(el.value)||0));
          if(shift.breaks[idx]) shift.breaks[idx].minutes = v;
          saveState();
          renderActive();
        });
      });
      card.querySelectorAll("[data-bdel]").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          const idx = Number(btn.getAttribute("data-bdel"));
          shift.breaks.splice(idx,1);
          saveState();
          renderActive();
        });
      });

      // end shift
      card.querySelector("[data-endshift]").addEventListener("click", ()=>{
        // Require signature to end: we do NOT end the shift here.
        openSignatureFor(shift);
      });


      activeWrap.appendChild(card);
    }

    // update history count pill without switching tabs
    $("historyCount").textContent = String(completedShifts().length);
  }

  // ---- signature modal ----
  const sigDialog = $("sigDialog");
  const sigEndTimeSelect = $("sigEndTimeSelect");
  const sigEndTimeCustom = $("sigEndTimeCustom");
  const sigEndDate = $("sigEndDate");
  const sigCanvas = $("sigCanvas");
  const sigClear = $("sigClear");
  const sigCancel = $("sigCancel");
  const sigSave = $("sigSave");

  // End time dropdown is more reliable than <input type="time"> on iPad Safari.
  if(sigEndTimeSelect && (!sigEndTimeSelect.options || !sigEndTimeSelect.options.length)){
    sigEndTimeSelect.innerHTML = buildQuarterHourOptionsHtml();
  }
  sigEndTimeSelect?.addEventListener("change", ()=>{
    if(sigEndTimeSelect.value === "CUSTOM"){
      sigEndTimeCustom.style.display = "block";
      sigEndTimeCustom.focus();
    }else{
      sigEndTimeCustom.style.display = "none";
      sigEndTimeCustom.value = "";
    }
  });

  const sigCtx = sigCanvas.getContext("2d");
  let sigDrawing = false;
  let sigEmpty = true;
  /** @type {Shift|null} */
  let sigTargetShift = null;

  function updateSigSaveState(){
    if(!sigSave) return;
    sigSave.disabled = !!sigEmpty;
  }

  function clearSignature(){
    const rect = sigCanvas.getBoundingClientRect();
    sigCtx.clearRect(0, 0, rect.width, rect.height);
    sigCtx.fillStyle = "#ffffff";
    sigCtx.fillRect(0, 0, rect.width, rect.height);
    sigEmpty = true;
    updateSigSaveState();
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
    updateSigSaveState();
  });
  sigCanvas.addEventListener("pointermove", (e)=>{
    if(!sigDrawing) return;
    const p = getPos(e);
    sigCtx.lineTo(p.x, p.y);
    sigCtx.lineWidth = 3;
    sigCtx.lineCap = "round";
    sigCtx.strokeStyle = "#0f172a";
    sigCtx.stroke();
  });
  sigCanvas.addEventListener("pointerup", ()=>{ sigDrawing = false; });
  sigCanvas.addEventListener("pointercancel", ()=>{ sigDrawing = false; });

  sigClear.addEventListener("click", ()=>clearSignature());

  function applyEndTimeFromInput(shift){
    let t = (sigEndTimeSelect?.value || "").trim();
    if(t === "CUSTOM"){
      t = (sigEndTimeCustom?.value || "").trim();
      if(!/^\d{2}:\d{2}$/.test(t)){
        alert("Custom end time must be HH:MM (e.g. 01:30).");
        return false;
      }
    }
    if(!/^\d{2}:\d{2}$/.test(t)){
      alert("Please choose a valid end time.");
      return false;
    }

    let endDate = (sigEndDate?.value || "").trim();
    if(!endDate) endDate = shift.date;

    const [hh, mm] = t.split(":").map(Number);
    const [y, m, d] = endDate.split("-").map(Number);
    let endMs = new Date(y, m-1, d, hh, mm, 0, 0).getTime();

    if(endDate === shift.date && endMs < shift.start){
      const bumped = new Date(endMs);
      bumped.setDate(bumped.getDate() + 1);
      endMs = bumped.getTime();
      const iso = localISODateFromMs(bumped.getTime());
      if(sigEndDate) sigEndDate.value = iso;
    }

    shift.end = endMs;

    if(shift.end < shift.start){
      alert("End date/time cannot be before start date/time.");
      return false;
    }
    return true;
  }

  function openSignatureFor(shift){
    sigTargetShift = shift;

    if(sigEndTimeSelect && (!sigEndTimeSelect.options || !sigEndTimeSelect.options.length)){
      sigEndTimeSelect.innerHTML = buildQuarterHourOptionsHtml();
    }

    if(sigEndDate) sigEndDate.value = shift.date;

    const hhmm = nearestQuarter();
    if(sigEndTimeSelect) sigEndTimeSelect.value = hhmm;
    if(sigEndTimeCustom){
      sigEndTimeCustom.value = "";
      sigEndTimeCustom.style.display = "none";
    }

    setTimeout(()=>{ clearSignature(); updateSigSaveState(); }, 0);
    sigDialog.showModal();
  }

  function closeSigDialog(){
    try{ sigDialog.close(); }catch{}
  }

  // Prevent accidental close (Esc/backdrop). Must use Back or Save.
  sigDialog.addEventListener("cancel", (e)=>{ e.preventDefault(); });

  sigCancel.addEventListener("click", ()=>{
    // Back: keep shift active. Nothing saved.
    sigTargetShift = null;
    closeSigDialog();
    renderActive();
  });

  sigSave.addEventListener("click", ()=>{
    if(!sigTargetShift) return;

    if(sigEmpty){
      alert("Signature required to end shift.");
      return;
    }

    if(!applyEndTimeFromInput(sigTargetShift)) return;

    const rect = sigCanvas.getBoundingClientRect();
    const temp = document.createElement("canvas");
    temp.width = Math.floor(rect.width);
    temp.height = Math.floor(rect.height);
    const tctx = temp.getContext("2d");
    tctx.drawImage(sigCanvas, 0, 0, rect.width, rect.height, 0, 0, rect.width, rect.height);
    sigTargetShift.signatureDataUrl = temp.toDataURL("image/png");

    saveState();
    sigTargetShift = null;
    closeSigDialog();
    renderActive();
    renderHistory();
  });

  // ---- history ----
  const historyList = $("historyList");
  const historySearch = $("historySearch");
  const historyDate = $("historyDate");
  const historyClear = $("historyClear");
  const historyCount = $("historyCount");
  const noHistory = $("noHistory");

  historySearch.addEventListener("input", renderHistory);
  historyDate.addEventListener("change", renderHistory);
  historyClear.addEventListener("click", ()=>{
    historySearch.value = "";
    historyDate.value = "";
    renderHistory();
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
            <div class="small">Breaks: ${breakMinutes(s)} min · Signature: ${s.signatureDataUrl ? "Yes" : "No"}</div>
          </div>
          <div class="actions" style="margin:0">
            <button class="btn" data-view type="button">View / edit</button>
          </div>
        </div>
      `;
      div.querySelector("[data-view]").addEventListener("click", ()=>openDetail(s.id));
      historyList.appendChild(div);
    }
  }

  // ---- detail modal ----
  const detailDialog = $("detailDialog");
  const detailBody = $("detailBody");
  const detailClose = $("detailClose");
  const detailSave = $("detailSave");
  const detailDownloadSig = $("detailDownloadSig");
  const detailDelete = $("detailDelete");

  /** @type {string|null} */
  let detailShiftId = null;

  detailClose.addEventListener("click", ()=>{
    detailShiftId = null;
    try{ detailDialog.close(); }catch{}
  });

  detailDelete.addEventListener("click", ()=>{
    if(!detailShiftId) return;
    if(!confirm("Delete this shift? This cannot be undone.")) return;
    state.shifts = state.shifts.filter(s => s.id !== detailShiftId);
    saveState();
    detailShiftId = null;
    try{ detailDialog.close(); }catch{}
    renderHistory();
    renderActive();
  });

  detailDownloadSig.addEventListener("click", ()=>{
    if(!detailShiftId) return;
    const s = state.shifts.find(x=>x.id===detailShiftId);
    if(!s || !s.signatureDataUrl){
      alert("No signature saved for this shift.");
      return;
    }
    const a = document.createElement("a");
    a.href = s.signatureDataUrl;
    const safeName = (s.name || "staff").replace(/[^a-z0-9\-_\s]/gi,"").trim().replace(/\s+/g,"-");
    const safeEvent = (s.event || "event").replace(/[^a-z0-9\-_\s]/gi,"").trim().replace(/\s+/g,"-");
    a.download = `Signature-${safeEvent}-${safeName}-${s.date}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  detailSave.addEventListener("click", ()=>{
    if(!detailShiftId) return;
    const s = state.shifts.find(x=>x.id===detailShiftId);
    if(!s) return;

    // times
    const startVal = (detailBody.querySelector("[data-edit-start]")?.value || "").trim();
    const endVal = (detailBody.querySelector("[data-edit-end]")?.value || "").trim();

    if(/^\d{2}:\d{2}$/.test(startVal)) setShiftTimeFromHHMM(s, "start", startVal);
    if(/^\d{2}:\d{2}$/.test(endVal)) setShiftTimeFromHHMM(s, "end", endVal);

    if(s.end < s.start){
      alert("End time cannot be before start time.");
      return;
    }

    // breaks
    const rows = detailBody.querySelectorAll("[data-edit-break]");
    const newBreaks = [];
    rows.forEach(row=>{
      const type = (row.querySelector("[data-btype]")?.value || "").trim() || "Break";
      const mins = Math.max(0, Math.round(Number(row.querySelector("[data-bmins]")?.value || 0)));
      newBreaks.push({type, minutes: mins});
    });
    s.breaks = newBreaks;

    saveState();
    renderHistory();
    renderActive();
    alert("Saved.");
  });

  function openDetail(id){
    const s = state.shifts.find(x=>x.id===id);
    if(!s) return;
    detailShiftId = id;

    const breaksRows = (s.breaks||[]).map((b, idx)=>{
      return `
        <div class="breakRow" data-edit-break="${idx}">
          <label class="field" style="margin:0; min-width:200px">
            <span>Break type</span>
            <input data-btype value="${escapeHtml(b.type)}">
          </label>
          <label class="field" style="margin:0">
            <span>Minutes</span>
            <input data-bmins type="number" min="0" step="1" value="${Number(b.minutes)||0}">
          </label>
        </div>
      `;
    }).join("");

    detailBody.innerHTML = `
      <div class="small"><span class="badge">${escapeHtml(s.event)}</span> <span class="badge">${escapeHtml(s.date)}</span></div>
      <div style="margin-top:6px"><strong>${escapeHtml(s.name)}</strong></div>

      <div class="grid" style="margin-top:12px">
        <label class="field">
          <span>Start time</span>
          <input data-edit-start type="time" value="${niceTime(s.start)}">
        </label>
        <label class="field">
          <span>End time</span>
          <input data-edit-end type="time" value="${niceTime(s.end)}">
        </label>
      </div>

      <div class="small" style="margin-top:10px">
        Total minutes: ${totalMinutes(s)} · Break minutes: ${breakMinutes(s)} · Worked minutes: ${workedMinutes(s)}
      </div>

      <div class="small" style="margin-top:12px"><strong>Breaks</strong> (edit minutes or type)</div>
      ${breaksRows || `<div class="muted" style="margin-top:8px">No breaks recorded.</div>`}

      <div class="actions" style="margin-top:12px">
        <button class="btn ok" type="button" data-add-break>+ Add break row</button>
      </div>

      ${s.signatureDataUrl ? `<div class="small" style="margin-top:12px"><strong>Signature</strong></div><img alt="Signature" src="${s.signatureDataUrl}">`
                             : `<div class="small" style="margin-top:12px"><strong>Signature</strong>: No</div>`}
    `;

    // add row button
    detailBody.querySelector("[data-add-break]")?.addEventListener("click", ()=>{
      s.breaks = s.breaks || [];
      s.breaks.push({type:"Custom", minutes:0});
      saveState();
      openDetail(id);
    });

    detailDownloadSig.disabled = !s.signatureDataUrl;
    detailDialog.showModal();
  }

  // ---- export CSV ----
  const exportEvent = $("exportEvent");
  const exportFrom = $("exportFrom");
  const exportTo = $("exportTo");
  const exportCSV = $("exportCSV");
  const exportSignatures = $("exportSignatures");

  exportCSV.addEventListener("click", ()=>{
    const stamp = localISODateFromMs(Date.now());

    // Human readable export (local device time) - payroll ready
    const rows = [];
    rows.push([
      "Event",
      "Staff",
      "StartDate",
      "StartTime",
      "EndDate",
      "EndTime",
      "BreakMinutes",
      "WorkedMinutes",
      "WorkedHours"
    ].map(escapeCsv).join(","));

    const ended = completedShifts().sort((a,b)=> (a.start||0)-(b.start||0));
    for(const s of ended){
      const startDate = localISODateFromMs(s.start);
      const endDate = localISODateFromMs(s.end);
      const startTime = format12hFromMsLocal(s.start);
      const endTime = format12hFromMsLocal(s.end);

      const bmin = breakMinutes(s);
      const wmin = workedMinutes(s);
      const whrs = (wmin/60).toFixed(2);

      rows.push([
        s.event || "",
        s.name || "",
        startDate,
        startTime,
        endDate,
        endTime,
        String(bmin),
        String(wmin),
        whrs
      ].map(escapeCsv).join(","));
    }

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
    setTimeout(()=>URL.revokeObjectURL(url), 800);
  }

  // ---- export signatures combined PNG ----
  exportSignatures.addEventListener("click", async ()=>{
    const signed = completedShifts().filter(s => s.signatureDataUrl);
    if(!signed.length){
      alert("No signatures available to export.");
      return;
    }

    // load images first (iOS Safari needs this)
    const imgs = await Promise.all(signed.map(s => loadImage(s.signatureDataUrl)));

    const padding = 24;
    const line1 = 24;
    const line2 = 22;
    const sigWidth = 860;
    const sigHeight = 220;
    const blockHeight = padding + line1 + line2 + 8 + sigHeight + padding;

    const canvas = document.createElement("canvas");
    canvas.width = sigWidth + padding*2;
    canvas.height = blockHeight * signed.length;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.fillStyle = "#0f172a";
    ctx.font = "18px system-ui, sans-serif";

    let y = 0;
    for(let i=0;i<signed.length;i++){
      const s = signed[i];
      const img = imgs[i];

      const top = y + padding;
      ctx.fillText(`${s.name}`, padding, top + line1);
      ctx.fillText(`${s.event} | ${s.date} | Worked minutes: ${workedMinutes(s)}`, padding, top + line1 + line2);

      ctx.drawImage(img, padding, top + line1 + line2 + 8, sigWidth, sigHeight);

      // divider line (except last)
      if(i < signed.length - 1){
        ctx.strokeStyle = "rgba(15,23,42,.12)";
        ctx.beginPath();
        ctx.moveTo(padding, y + blockHeight - 1);
        ctx.lineTo(canvas.width - padding, y + blockHeight - 1);
        ctx.stroke();
      }

      y += blockHeight;
    }

    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    a.download = `All-Signatures-${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  function loadImage(dataUrl){
    return new Promise((resolve, reject)=>{
      const img = new Image();
      img.onload = ()=>resolve(img);
      img.onerror = ()=>reject(new Error("Image failed to load"));
      img.src = dataUrl;
    });
  }

  // init
  renderActive();
  renderHistory();
})();
