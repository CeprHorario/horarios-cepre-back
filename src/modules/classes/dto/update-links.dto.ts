import { IsString, MaxLength, ValidateBy } from 'class-validator';

function AcademicLink(host: string) {
  return ValidateBy({
    name: 'academicLink',
    validator: {
      validate(value: unknown) {
        if (value === '') return true;
        if (typeof value !== 'string') return false;
        try {
          const url = new URL(value);
          return (
            url.protocol === 'https:' &&
            url.hostname === host &&
            !url.username &&
            !url.password &&
            !url.port
          );
        } catch {
          return false;
        }
      },
      defaultMessage: () =>
        `Usa un enlace HTTPS de ${host}, o un texto vacío para quitarlo`,
    },
  });
}

export class UpdateMeetLinkDto {
  @IsString()
  @MaxLength(2048)
  @AcademicLink('meet.google.com')
  urlMeet!: string;
}
export class UpdateClassroomLinkDto {
  @IsString()
  @MaxLength(2048)
  @AcademicLink('classroom.google.com')
  urlClassroom!: string;
}
