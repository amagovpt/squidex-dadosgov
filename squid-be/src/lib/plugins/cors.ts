import cors from "cors";
import { envParser } from "../envParser";

export default cors({
  origin: ["http://localhost:3000",envParser.FRONTEND_ORIGIN],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Origin",
    "Accept",
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Access-Control-Allow-Headers",
    "Access-Control-Allow-Origin",
    "Access-Control-Allow-Credentials",
    "X-Api-Key",
  ],
});