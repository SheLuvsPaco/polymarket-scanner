for (let page = 0; page < 4; page++) {
    const f = await fetch("https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=25&offset=" + (page * 25));
    const d = await f.json();
    for (const m of d) {
        if (m.active && m.closed === false) {
            console.log((page*25 + d.indexOf(m) + 1) + ". " + m.slug + " | $" + Math.round(parseFloat(m.volume24hr || 0)).toLocaleString());
        }
    }
}
