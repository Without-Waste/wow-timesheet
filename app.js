
(() => {
  "use strict";

  // ---------- storage ----------
  const STORAGE_KEY = "wow_timesheet_v2";
  /** @type {{shifts: Shift[]}} */
  let state = loadState();

  /**
   * @typedef {Object} Break
   * @property {string} type
   * @property {number} start
   * @property {number|null} end
   */
  /**
   * @typedef {Object} Shift
   * @property {string} id
   * @property {string} event
   * @property {string} name
   * @property {string} date   // YYYY-MM-DD
   * @property {number} start  // ms epoch
   * @property {number|null} end // ms epoch
   * @property {Break[]} breaks
   */

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

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);

  function pad2(n){ return String(n).padStart(2, "0"); }
  function nowTimeHHMM(){
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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

  function activeShifts(){
    return state.shifts.filter(s => !s.end);
  }
  function completedShifts(){
    return state.shifts.filter(s => !!s.end);
  }

  function activeBreak(shift){
    return shift.breaks.find(b => b.end === null) || null;
  }

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

  // ---------- DOM ----------
  const eventInput = $("eventName");
  const nameInput  = $("staffName");
  const dateInput  = $("shiftDate");
  const timeInput  = $("shiftStart");

  const exportEvent = $("exportEvent");
  const exportFrom  = $("exportFrom");
  const exportTo    = $("exportTo");

  const startBtn = $("startShift");
  const clearBtn = $("clearInputs");
  const exportBtn = $("exportCSV");

  const activeWrap = $("activeShifts");
  const noActive = $("noActive");
  const activeCount = $("activeCount");

  // defaults
  dateInput.valueAsDate = new Date();
  timeInput.value = nowTimeHHMM();

  // ---------- actions ----------
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
      breaks: []
    };

    state.shifts.push(shift);
    saveState();
    renderActive();

    // keep event filled (often same), clear name only
    nameInput.value = "";
    timeInput.value = nowTimeHHMM();
  });

  clearBtn.addEventListener("click", () => {
    eventInput.value = "";
    nameInput.value = "";
    dateInput.valueAsDate = new Date();
    timeInput.value = nowTimeHHMM();
  });

  exportBtn.addEventListener("click", () => {
    const ev = (exportEvent.value || "").trim().toLowerCase();
    const from = (exportFrom.value || "").trim();
    const to = (exportTo.value || "").trim();

    const rows = [];
    rows.push([
      "EntryID","Event","Date","Name",
      "ShiftStart","ShiftEnd",
      "TotalShiftMinutes","BreakMinutes","WorkedMinutes",
      "BreakCount","Breaks"
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
        breaksField
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

  // ---------- render ----------
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
              <option value="Meal">Meal</option>
              <option value="Custom">Custom</option>
            </select>
          </label>

          <button class="btn ${ab ? "" : "ok"}" data-start-break ${ab ? "disabled" : ""} type="button">Start break</button>
          <button class="btn ${ab ? "ok" : ""}" data-end-break ${ab ? "" : "disabled"} type="button">End break</button>
          <button class="btn danger" data-end-shift type="button">End shift</button>
        </div>
      `;

      // wire buttons (no inline onclick)
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
        const end = Date.now();
        if(!confirm(`End shift for ${shift.name}?`)) return;
        shift.end = end;
        saveState();
        renderActive();
      });

      activeWrap.appendChild(card);
    }
  }

  function escapeHtml(s){
    return (s ?? "").toString()
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  // initial paint
  renderActive();
})();
