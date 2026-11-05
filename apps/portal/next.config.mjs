import {fileURLToPath} from 'node:url';
export default {output:'standalone',logging:{incomingRequests:false},outputFileTracingRoot:fileURLToPath(new URL('../../',import.meta.url))};
