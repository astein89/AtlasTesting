import type { NextFunction, Request, RequestHandler, Response } from 'express'

/** Express 4: run async route logic and forward rejections to `next`. */
export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
