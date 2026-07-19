function createICS(events) {

    let ics =
`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//PROJECT SALUS//Mission Control//JP
`;

    events.forEach(event => {

        const date = event.replaceAll("-", "");

        ics +=
`BEGIN:VEVENT
DTSTART;VALUE=DATE:${date}
DTEND;VALUE=DATE:${date}
SUMMARY:PROJECT SALUS
END:VEVENT
`;

    });

    ics += "END:VCALENDAR";

    return ics;
}
const button = document.getElementById("calendarButton");

button.addEventListener("click", () => {

    const startDate = new Date(document.getElementById("startDate").value);
    const endDate = new Date(document.getElementById("endDate").value);

    const result = document.getElementById("result");
    result.innerHTML = "";

    const current = new Date(startDate);

    const dates = [];

    while (current <= endDate) {

        dates.push(
    current.toISOString().split("T")[0]
);
current.setDate(current.getDate() + 1);
}
const ics = createICS(dates);

const blob = new Blob([ics], {
    type: "text/calendar"
});

const link = document.createElement("a");

link.href = URL.createObjectURL(blob);
link.download = "PROJECT_SALUS.ics";

link.click();

URL.revokeObjectURL(link.href);

result.innerText = "✅ PROJECT_SALUS.ics を作成しました";
});