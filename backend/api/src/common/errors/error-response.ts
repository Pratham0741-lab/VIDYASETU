import { ApiProperty } from '@nestjs/swagger';
import { ErrorCode } from './error-code.enum';

export type ErrorDetails = Record<string, unknown> | unknown[] | null;

/** The one error shape every endpoint returns. */
export interface ErrorResponseBody {
  code: string;
  message: string;
  details: ErrorDetails;
  requestId: string;
}

/** OpenAPI description of ErrorResponseBody. */
export class ErrorResponseDto implements ErrorResponseBody {
  @ApiProperty({ enum: ErrorCode, example: ErrorCode.NOT_FOUND })
  code!: string;

  @ApiProperty({ example: 'The requested resource was not found.' })
  message!: string;

  @ApiProperty({
    nullable: true,
    oneOf: [{ type: 'object' }, { type: 'array', items: {} }],
    example: null,
  })
  details!: ErrorDetails;

  @ApiProperty({ example: '3f2b8c1e-4a8d-4f1b-9e0a-6f4d2c1b7a90' })
  requestId!: string;
}

export function buildErrorResponse(
  code: string,
  message: string,
  details: ErrorDetails,
  requestId: string,
): ErrorResponseBody {
  return { code, message, details: details ?? null, requestId };
}
