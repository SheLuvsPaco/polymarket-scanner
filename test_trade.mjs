import WebSocket from "ws";
const f = await fetch("https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false");
const d = await f.json();
const tokens = [];
for (const m of d) {
    if (m.active && m.closed === false && m.clobTokenIds) {
        tokens.push(...JSON.parse(m.clobTokenIds));
    }
}
const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");
ws.on("open", () => {
    ws.send(JSON.stringify({ assets_ids: tokens }));
});
ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.event_type === "last_trade_price") {
        console.log(JSON.stringify(msg));
    }
});
setTimeout(() => process.exit(), 15000);
