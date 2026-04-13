const f = await fetch("https://gamma-api.polymarket.com/markets?active=true&closed=false");
const d = await f.json();
for (const m of d) {
    if (m.active && m.closed === false) {
        console.log(m.slug, "| volume24hr:", m.volume24hr, "| liquidity:", m.liquidity);
    }
}
