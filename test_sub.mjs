import WebSocket from "ws";

const f = await fetch("https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false");
const d = await f.json();
const allTokens = [];
for (const m of d) {
    if (m.active && m.closed === false && m.clobTokenIds) {
        const tokens = JSON.parse(m.clobTokenIds);
        allTokens.push(...tokens);
    }
}
console.log("Token count:", allTokens.length);
console.log("First 3 tokens:", allTokens.slice(0,3));

const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");

ws.on("open", () => {
    console.log("Connected");
    const payload = { assets_ids: allTokens };
    console.log("Sending (no type field)...");
    ws.send(JSON.stringify(payload));
});

ws.on("message", (data) => {
    const raw = data.toString();
    console.log("MSG:", raw.substring(0, 300));
});

ws.on("error", (e) => console.log("Error:", e.message));
setTimeout(() => { console.log("Done"); process.exit(); }, 60000);
