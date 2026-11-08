// Provider adapter: thay provider tại đây, không cần sửa frontend/controller.
exports.edit=async(client,{file,prompt})=>{
  const result=await client.images.edit({model:process.env.IMAGE_STUDIO_AI_MODEL||"gpt-image-1",image:file,prompt,size:"auto"});
  const item=result.data?.[0];
  if(!item?.b64_json)throw new Error("AI provider returned no image.");
  return {base64:item.b64_json,mimeType:"image/png"};
};