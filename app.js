
let shifts = [];

const eventInput = document.getElementById("eventName");
const nameInput = document.getElementById("staffName");
const dateInput = document.getElementById("shiftDate");
const activeContainer = document.getElementById("activeShifts");
const startBtn = document.getElementById("startShift");
const exportBtn = document.getElementById("exportCSV");

dateInput.valueAsDate = new Date();

startBtn.addEventListener("click", () => {
  if (!eventInput.value || !nameInput.value) return;

  const shift = {
    id: Date.now(),
    event: eventInput.value,
    name: nameInput.value,
    date: dateInput.value,
    start: new Date(),
    end: null,
    breaks: []
  };

  shifts.push(shift);
  render();
  eventInput.value = "";
  nameInput.value = "";
});

function render() {
  activeContainer.innerHTML = "";

  shifts.filter(s => !s.end).forEach(shift => {
    const card = document.createElement("div");
    card.className = "shift-card";

    card.innerHTML = `
      <strong>${shift.name}</strong><br>
      Started: ${shift.start.toLocaleTimeString()}<br>
      <button onclick="startBreak(${shift.id})">Start Break</button>
      <button onclick="endBreak(${shift.id})">End Break</button>
      <button onclick="endShift(${shift.id})">End Shift</button>
    `;

    activeContainer.appendChild(card);
  });
}

window.startBreak = function(id) {
  const shift = shifts.find(s => s.id === id);
  shift.breaks.push({ start: new Date(), end: null });
};

window.endBreak = function(id) {
  const shift = shifts.find(s => s.id === id);
  const activeBreak = shift.breaks.find(b => !b.end);
  if (activeBreak) activeBreak.end = new Date();
};

window.endShift = function(id) {
  const shift = shifts.find(s => s.id === id);
  shift.end = new Date();
  render();
};

exportBtn.addEventListener("click", () => {
  const rows = [];
  rows.push("Event,Date,Name,ShiftStart,ShiftEnd,Breaks");

  shifts.forEach(s => {
    if (!s.end) return;

    const breakSummary = s.breaks.map(b => {
      if (!b.end) return "";
      return `${b.start.toISOString()}|${b.end.toISOString()}`;
    }).join(";");

    rows.push([
      s.event,
      s.date,
      s.name,
      s.start.toISOString(),
      s.end.toISOString(),
      breakSummary
    ].join(","));
  });

  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "Timesheets.csv";
  a.click();
});
