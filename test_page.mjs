const f1 = await fetch("https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=25&offset=0");
const d1 = await f1.json();
const f2 = await fetch("https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=25&offset=25");
const d2 = await f2.json();
console.log("Page 1:", d1.length, "markets, first:", d1[0]?.slug);
console.log("Page 2:", d2.length, "markets, first:", d2[0]?.slug);
console.log("Overlap check:", d1[0]?.id === d2[0]?.id ? "OVERLAP" : "NO OVERLAP");
