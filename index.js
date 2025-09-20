
import { pump_geyser } from "./main.js";
import { getBalance } from "./swap.js";
import dotenv from "dotenv";

dotenv.config()


export const decodedPrivateKey = process.env.PRIVATE_KEY;

pump_geyser()

