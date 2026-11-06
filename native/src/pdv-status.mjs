/** Classificação sem dados pessoais, tokens ou conteúdo arbitrário de erro. */
export function classifyPdvStatus(httpStatus,mode){
  if(httpStatus===401)return {ok:false,reason:'TOKEN_REJECTED',mode:null};
  if(httpStatus===403)return {ok:false,reason:'PDV_DISABLED',mode:null};
  if(httpStatus===404)return {ok:false,reason:'ROUTE_NOT_FOUND',mode:null};
  if(httpStatus<200||httpStatus>=300)return {ok:false,reason:'HTTP_ERROR',mode:null};
  if(!['off','test','active'].includes(mode))return {ok:false,reason:'INVALID_PDV_MODE',mode:null};
  return {ok:true,reason:'OK',mode};
}
