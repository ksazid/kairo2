import type{FastifyInstance,FastifyReply,FastifyRequest}from"fastify";
import{KairoService,type KairoRepository}from"@kairo/domain";
import type{MetaMcpToolName}from"@kairo/contracts";
import type{IdentityVerifier}from"./auth";
import{META_MCP_TOOL_DEFINITIONS,MetaMcpToolHandler}from"./meta-mcp-tools";

export function registerMetaMcpRoutes(app:FastifyInstance,deps:{coreStore:KairoRepository;identityVerifier:IdentityVerifier;handler:MetaMcpToolHandler}){const core=new KairoService(deps.coreStore);
 app.get("/api/v1/mcp/meta/tools",async(request,reply)=>{const account=await auth(request,reply,core,deps.identityVerifier);if(!account)return;return{tools:META_MCP_TOOL_DEFINITIONS}});
 app.post<{Params:{toolName:string};Body:unknown}>("/api/v1/mcp/meta/tools/:toolName/invoke",async(request,reply)=>{const account=await auth(request,reply,core,deps.identityVerifier);if(!account)return;const name=request.params.toolName;if(!META_MCP_TOOL_DEFINITIONS.some(tool=>tool.name===name))return reply.status(404).send({type:"about:blank",title:"Not Found",status:404,detail:"Meta MCP tool is not supported",code:"not-found",correlationId:request.id});return{content:[{type:"text",text:JSON.stringify(await deps.handler.invoke(account.id,name as MetaMcpToolName,request.body))}]}});
}
async function auth(request:FastifyRequest,reply:FastifyReply,core:KairoService,verifier:IdentityVerifier){const identity=await verifier.verify(request.headers.authorization);if(!identity){await reply.status(401).send({type:"about:blank",title:"Unauthorized",status:401,detail:"Authentication is required",code:"unauthorized",correlationId:request.id});return null}return core.establishSession(identity)}
