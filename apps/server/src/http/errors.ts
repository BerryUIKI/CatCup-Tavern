export class HttpError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string,
        public readonly code?: string,
    ) {
        super(message);
        this.name = 'HttpError';
    }
}

export function badRequest(message: string, code = 'BAD_REQUEST'): HttpError {
    return new HttpError(400, message, code);
}

export function unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED'): HttpError {
    return new HttpError(401, message, code);
}

export function forbidden(message = 'Forbidden', code = 'FORBIDDEN'): HttpError {
    return new HttpError(403, message, code);
}

export function notFound(message = 'Not found'): HttpError {
    return new HttpError(404, message, 'NOT_FOUND');
}
