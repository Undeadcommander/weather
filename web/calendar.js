export function createDatePicker(container, onSelect) {
  const shortcuts = container.querySelector("#dates");
  const trigger = container.querySelector("#calendar-trigger");
  const selection = container.querySelector("#calendar-selection");
  const calendar = container.querySelector("#forecast-calendar");
  const fullDate = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "full" });
  const monthName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
  let signature;

  function dayButton(key, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.day = key;
    button.textContent = label;
    return button;
  }

  function drawMonth(month, available) {
    const section = document.createElement("div");
    const first = new Date(`${month}-01T00:00:00Z`);
    const heading = document.createElement("strong");
    heading.textContent = monthName.format(first);
    const grid = document.createElement("div");
    grid.className = "calendar-grid";
    for (const label of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]) {
      const weekday = document.createElement("small");
      weekday.textContent = label;
      grid.append(weekday);
    }
    const date = new Date(first);
    while (date.getUTCMonth() === first.getUTCMonth()) {
      const key = date.toISOString().slice(0, 10);
      const day = date.getUTCDate();
      const cell = available.has(key) ? dayButton(key, day) : document.createElement("span");
      cell.textContent = day;
      if (available.has(key)) cell.setAttribute("aria-label", fullDate.format(date));
      if (day === 1) cell.style.gridColumnStart = String(first.getUTCDay() + 1);
      grid.append(cell);
      date.setUTCDate(day + 1);
    }
    section.append(heading, grid);
    return section;
  }

  function close() {
    calendar.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }

  trigger.addEventListener("click", () => {
    if (!calendar.hidden) return close();
    calendar.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    (calendar.querySelector('[aria-pressed="true"]') ?? calendar.querySelector("button"))?.focus();
  });
  container.addEventListener("click", event => {
    const day = event.target.closest("button[data-day]");
    if (!day) return;
    close();
    if (calendar.contains(day)) trigger.focus();
    onSelect(day.dataset.day);
  });
  container.addEventListener("keydown", event => {
    if (event.key === "Escape" && !calendar.hidden) {
      close();
      trigger.focus();
    }
  });
  document.addEventListener("pointerdown", event => {
    if (!container.contains(event.target)) close();
  });
  container.addEventListener("focusout", event => {
    if (!container.contains(event.relatedTarget)) close();
  });

  return function update(choices, available, selected) {
    const keys = choices.filter(({ key }) => available.has(key)).map(({ key }) => key);
    const next = [choices[0].key, ...keys].join(",");
    if (next !== signature) {
      signature = next;
      const hadFocus = calendar.contains(document.activeElement);
      shortcuts.replaceChildren(...choices.slice(0, 2).map(({ key, label }) => {
        const button = dayButton(key, label);
        button.disabled = !available.has(key);
        return button;
      }));
      const months = new Set(keys.map(key => key.slice(0, 7)));
      calendar.replaceChildren(...Array.from(months, month => drawMonth(month, available)));
      if (hadFocus) trigger.focus();
    }
    trigger.disabled = !keys.length;
    if (trigger.disabled) close();
    const choice = choices.find(({ key }) => key === selected);
    selection.textContent = choice && !choices.slice(0, 2).includes(choice) ? choice.label : "";
    trigger.setAttribute("aria-label", selection.textContent ? `Choose forecast date, ${selection.textContent}` : "Choose forecast date");
    for (const button of container.querySelectorAll("button[data-day]")) {
      button.setAttribute("aria-pressed", String(button.dataset.day === selected));
    }
  };
}
