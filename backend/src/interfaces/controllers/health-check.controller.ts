import { Response, Request } from "express";

const healthCheck = async (req: Request, res: Response) => {
  res.send({ status: "Server running" }).status(200)
  return res;
};


export default { healthCheck };

