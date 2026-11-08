const OpenAI=require("openai");
const {toFile}=require("openai/uploads");
const adapter=require("./image-provider.adapter");
exports.edit=async({buffer,mimeType,prompt})=>{
  if(!process.env.OPENAI_API_KEY)throw new Error("AI provider is not configured.");
  const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
  const file=await toFile(buffer,"source-image."+({ "image/jpeg":"jpg","image/webp":"webp" }[mimeType]||"png"),{type:mimeType});
  return adapter.edit(client,{file,prompt});
};