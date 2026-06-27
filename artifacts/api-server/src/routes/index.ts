import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import usersRouter from "./users";
import eventsRouter from "./events";
import guestsRouter from "./guests";
import mediaRouter from "./media";
import subscriptionsRouter from "./subscriptions";
import vendorsRouter from "./vendors";
import billingRouter from "./billing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(usersRouter);
router.use(eventsRouter);
router.use(guestsRouter);
router.use(mediaRouter);
router.use(subscriptionsRouter);
router.use(vendorsRouter);
router.use(billingRouter);

export default router;
