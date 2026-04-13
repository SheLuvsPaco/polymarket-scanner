const f = await fetch("https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false");
const d = await f.json();
for (const m of d.slice(0, 10)) {
    if (m.active && m.closed === false) {
        console.log(m.slug, "| vol24h:", m.volume24hr, "| liq:", m.liquidity);
    }
}
