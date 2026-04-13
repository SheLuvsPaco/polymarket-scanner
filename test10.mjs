import WebSocket from "ws";

const f = await fetch("https://gamma-api.polymarket.com/markets?active=true&closed=false");
const d = await f.json();
const allTokens = [];
for (const m of d) {
    if (m.active && m.closed === false && m.clobTokenIds) {
        const tokens = JSON.parse(m.clobTokenIds);
        allTokens.push(...tokens);
    }
}
console.log("Subscribing to", allTokens.length, "tokens");

const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");
let tradeCount = 0;
let otherCount = 0;

ws.on("open", () => {
    ws.send(JSON.stringify({ type: "market", assets_ids: allTokens }));
    console.log("Subscribed, waiting...");
});

ws.on("message", (data) => {
    const raw = data.toString();
    try {
        const msg = JSON.parse(raw);
        if (msg.event === "trade") {
            tradeCount++;
            console.log("TRADE:", raw.substring(0, 300));
        } else {
            otherCount++;
            if (otherCount <= 3) console.log("OTHER event:", msg.event || "unknown");
        }
    } catch(e) {}
});

setInterval(() => console.log(`Status: ${tradeCount} trades, ${otherCount} other`), 15000);
setTimeout(() => { console.log("Done"); process.exit(); }, 120000);
