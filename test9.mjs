import WebSocket from "ws";

const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");
let tradeCount = 0;
let otherCount = 0;

ws.on("open", () => {
    console.log("Connected");
    const payload = { type: "market", assets_ids: ["8501497159083948713316135768103773293754490207922884688769443031624417212426"] };
    ws.send(JSON.stringify(payload));
    console.log("Subscribed, waiting for trades...");
});

ws.on("message", (data) => {
    const raw = data.toString();
    if (raw.startsWith("{") || raw.startsWith("[")) {
        const msg = JSON.parse(raw);
        if (Array.isArray(msg)) {
            for (const item of msg) {
                if (item.event === "trade") {
                    tradeCount++;
                    console.log("TRADE:", JSON.stringify(item).substring(0, 200));
                } else {
                    otherCount++;
                }
            }
        } else if (msg.event === "trade") {
            tradeCount++;
            console.log("TRADE:", raw.substring(0, 200));
        } else {
            otherCount++;
        }
    }
});

setInterval(() => {
    console.log(`Status: ${tradeCount} trades, ${otherCount} other messages`);
}, 10000);

setTimeout(() => {
    console.log(`Final: ${tradeCount} trades, ${otherCount} other messages`);
    ws.close();
}, 60000);
