import { Expose } from 'class-transformer';

export class MonitorBasicInfoDto {
  @Expose()
  id: string;

  @Expose()
  firstName: string;

  @Expose()
  lastName: string;

  @Expose()
  personalEmail: string;

  @Expose()
  phone: string | null;
}
