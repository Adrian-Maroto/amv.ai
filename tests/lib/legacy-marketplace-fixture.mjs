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
  "/v1/market/status": "case '/v1/market/status':   return marketSetStatus(request, env);",
  "/v1/market/view": "case '/v1/market/view':     return marketView(request, env);",
  "/v1/market/rate": "case '/v1/market/rate':     return marketRate(request, env);",
  "/v1/market/review": "case '/v1/market/review':   return marketReview(request, env);",
  "/v1/market/message": "case '/v1/market/message':  return marketMessage(request, env);",
  "/v1/market/threads": "case '/v1/market/threads':  return marketThreads(request, env);",
  "/v1/market/thread/read": "case '/v1/market/thread/read': return marketThreadRead(request, env);"
};
export function legacyMarketplaceFixture(source){
 for(const [route,prior] of Object.entries(routes)) source=source.replace("case '"+route+"': return marketplaceRetired(request, env);",prior);
 return source;
}
