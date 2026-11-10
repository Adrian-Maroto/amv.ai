// TEST ONLY. Restores historical Marketplace route dispatch in a synthetic harness.
// Production Marketplace endpoints return 410; marketplace-is-retired tests that contract.
// This retains regression coverage of legacy ledgers, settlements and moderation code.
// It must never be imported by production source or build.mjs.
const routes = {
  "/v1/market/list": "case '/v1/market/list':     return marketList(request, env);",
  "/v1/market/publish": "case '/v1/market/publish':  return marketPublish(request, env);",
  "/v1/market/install": "case '/v1/market/install':  return marketInstall(request, env);",
  "/v1/market/check": "case '/v1/market/check':    return marketCheck(request, env);",
  "/v1/market/buy": "case '/v1/market/buy':      return marketBuy(request, env);",
  "/v1/market/mylistings": "case '/v1/market/mylistings': return marketMyListings(request, env);",
  "/v1/market/rate": "case '/v1/market/rate':     return marketRate(request, env);",
  "/v1/market/review": "case '/v1/market/review':   return marketReview(request, env);",
  "/v1/market/message": "case '/v1/market/message':  return marketMessage(request, env);",
  "/v1/market/threads": "case '/v1/market/threads':  return marketThreads(request, env);",
  "/v1/market/thread/read": "case '/v1/market/thread/read': return marketThreadRead(request, env);"
};
/* LENGTH-PRESERVING. scripts/coverage.mjs maps a suite's harness back onto
   amv-backend.js by character offset; a replacement of a different length
   shifted every offset after the router, so every suite using this fixture
   had its coverage of every later file misattributed (Nov 10: team task
   notices read as never called). Each restored line is padded to exactly the
   length of the line it replaces, and one that would not fit is an error. */
export function legacyMarketplaceFixture(source){
 for(const [route,prior] of Object.entries(routes)){
  const now="case '"+route+"': return marketplaceRetired(request, env);";
  if(prior.length>now.length) throw new Error('legacy route line longer than the retired one: '+route);
  if(!source.includes(now)) continue;
  source=source.replace(now,prior+' '.repeat(now.length-prior.length));
 }
 return source;
}
