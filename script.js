function createICS(events) {
    let ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//PROJECT SALUS//Mission Control//EN
`;

    events.forEach(event => {
        const date = event.replaceAll("-", "");

        ics += `BEGIN:VEVENT
DTSTART;VALUE=DATE:${date}
DTEND;VALUE=DATE:${date}
SUMMARY:PROJECT SALUS
END:VEVENT
`;
    });

    ics += "END:VCALENDAR";

    return ics;
}

function updateClock() {
    const clockElement = document.getElementById("liveClock");

    if (!clockElement) {
        return;
    }

    const now = new Date();
    const timeString = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
    const dateString = now.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric"
    });

    clockElement.innerText = `${dateString} • ${timeString}`;
}

const button = document.getElementById("calendarButton");

updateClock();
setInterval(updateClock, 1000);

if (button) {
    button.addEventListener("click", () => {
        const startDate = document.getElementById("startDate").value;
        const endDate = document.getElementById("endDate").value;
        const specialWeek = document.getElementById("specialWeek").checked;
        const result = document.getElementById("result");

        result.innerHTML = "";

        if (!startDate) {
            result.innerText = "⚠️ Please enter a start date.";
            return;
        }

        if (!endDate) {
            result.innerText = "⚠️ Please enter an end date.";
            return;
        }

        if (new Date(startDate) > new Date(endDate)) {
            result.innerText = "⚠️ End date must be on or after the start date.";
            return;
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        const current = new Date(start);
        const dates = [];

        while (current <= end) {
            dates.push(current.toISOString().split("T")[0]);
            current.setDate(current.getDate() + 1);
        }

        const ics = createICS(dates);
        const fileName = specialWeek ? "PROJECT_SALUS_SPECIAL_WEEK.ics" : "PROJECT_SALUS.ics";

        const blob = new Blob([ics], {
            type: "text/calendar"
        });

        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();

        URL.revokeObjectURL(link.href);

        result.innerText = `✅ ${fileName} was created.`;
    });
}