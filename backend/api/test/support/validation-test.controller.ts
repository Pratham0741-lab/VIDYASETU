import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsString, Max, Min, MinLength, ValidateNested } from 'class-validator';
import { Public } from '../../src/auth/decorators';

class AddressDto {
  @IsString()
  @MinLength(6)
  pincode!: string;
}

export class CreateSampleDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

/**
 * TEST-ONLY controller used to exercise the global ValidationPipe.
 * Registered exclusively in the e2e testing module (test/support); it lives
 * outside src/ so it can never be compiled into or imported by the app.
 */
@Public()
@Controller('__test__')
export class ValidationTestController {
  @Post('validation')
  @HttpCode(200)
  create(@Body() dto: CreateSampleDto): { received: CreateSampleDto; quantityType: string } {
    return { received: dto, quantityType: typeof dto.quantity };
  }
}
