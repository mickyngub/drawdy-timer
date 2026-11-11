import { createTimerDriver } from "./driver";

const driver = createTimerDriver();

export const activate = driver.activate;
export const onEvent = driver.onEvent;
