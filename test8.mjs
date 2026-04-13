import WebSocket from "ws";

const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/trade");

ws.on("open", () => {
    console.log("Connected to /ws/trade");
    const payload = { type: "market", assets_ids: ["8501497159083948713316135768103773293754490207922884688769443031624417212426"] };
    ws.send(JSON.stringify(payload));
    console.log("Subscribed");
});

ws.on("message", (data) => {
    console.log("Response:", data.toString().substring(0, 300));
});

ws.on("error", (e) => console.log("Error:", e.message));
setTimeout(() => {
    console.log("--- Timeout ---");
    ws.close();
}, 30000);
