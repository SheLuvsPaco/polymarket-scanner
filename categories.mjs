let categories = { politics: 0, sports: 0, crypto: 0, geopolitical: 0, meme: 0, finance: 0, other: 0 };
for (let page = 0; page < 8; page++) {
    const f = await fetch("https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=25&offset=" + (page * 25));
    const d = await f.json();
    for (const m of d) {
        if (m.active && m.closed === false) {
            const s = m.slug.toLowerCase();
            if (s.includes("iran") || s.includes("ukraine") || s.includes("china") || s.includes("taiwan") || s.includes("kharg") || s.includes("hormuz") || s.includes("conflict") || s.includes("invade") || s.includes("regime") || s.includes("military") || s.includes("peace")) categories.geopolitical++;
            else if (s.includes("president") || s.includes("election") || s.includes("prime-minister") || s.includes("hungary") || s.includes("peru") || s.includes("colombia") || s.includes("fed-chair") || s.includes("nomination") || s.includes("rubio") || s.includes("haley") || s.includes("newsom") || s.includes("carlson") || s.includes("aoc") || s.includes("ocasio")) categories.politics++;
            else if (s.includes("bitcoin") || s.includes("btc") || s.includes("eth") || s.includes("crypto")) categories.crypto++;
            else if (s.includes("fed") || s.includes("interest-rate") || s.includes("crude-oil") || s.includes("wti")) categories.finance++;
            else if (s.includes("elon") || s.includes("musk") || s.includes("tweet")) categories.meme++;
            else if (s.includes("nhl") || s.includes("nba") || s.includes("epl") || s.includes("atp") || s.includes("cs2") || s.includes("lol") || s.includes("fifa") || s.includes("f1") || s.includes("nfl") || s.includes("cricket") || s.includes("wta") || s.includes("ucl") || s.includes("champions") || s.includes("arsenal") || s.includes("nascar")) categories.sports++;
            else categories.other++;
        }
    }
}
console.log("Category breakdown of 200 markets:");
for (const [cat, count] of Object.entries(categories).sort((a,b) => b[1] - a[1])) {
    console.log("  " + cat + ": " + count + " (" + Math.round(count/2) + "%)");
}
