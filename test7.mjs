import WebSocket from "ws";

const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");

ws.on("open", () => {
    console.log("Connected");
    
    // Try the assets_ids format (what we currently send)
    const payload1 = { type: "market", assets_ids: ["8501497159083948713316135768103773293754490207922884688769443031624417212426"] };
    console.log("Sending format 1:", JSON.stringify(payload1));
    ws.send(JSON.stringify(payload1));
});

ws.on("message", (data) => {
    console.log("Response:", data.toString().substring(0, 300));
});

ws.on("error", (e) => console.log("Error:", e.message));
setTimeout(() => {
    console.log("--- Timeout, closing ---");
    ws.close();
}, 10000);
