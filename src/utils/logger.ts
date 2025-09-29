const logPrefix = (level: string) => `[${level}]`;

const logger = {
	info: (...args: unknown[]) => console.log(logPrefix('INFO'), ...args),
	warn: (...args: unknown[]) => console.warn(logPrefix('WARN'), ...args),
	error: (...args: unknown[]) => console.error(logPrefix('ERROR'), ...args),
};

export default logger;
