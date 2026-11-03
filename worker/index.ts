import handler from 'vinext/server/fetch-handler';
import{aiRoute}from'../lib/ai';
export default{fetch(request:Request,env:Cloudflare.Env,ctx:ExecutionContext){if(new URL(request.url).pathname.startsWith('/api/'))return aiRoute(request,env as unknown as Record<string,string>);return handler.fetch(request,env,ctx)}};
