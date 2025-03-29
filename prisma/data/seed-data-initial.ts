import { CreateCourseDto } from '@modules/courses/dto';
import { GoogleAuthDto } from '@modules/auth/dto/auth-google.dto';
import { Role } from '@modules/auth/decorators/authorization.decorator';
import { CreateAreaDto } from '@modules/areas/dto';
import { CreateSedeDto } from '@modules/sedes/dto';

export const initialUsers: GoogleAuthDto[] = [
  {
    email: 'sistema.horarios@cepr.unsa.pe',
    role: Role.ADMIN,
  },
];

export const initalSedes: CreateSedeDto[] = [
  { name: 'Sede Central', description: 'Sede Calle San Agustín' },
];

export const initialAreas: CreateAreaDto[] = [
  { name: 'Ingenierías', description: 'Área de Ingenierías' },
  { name: 'Biomédicas', description: 'Área de Biomédicas' },
  { name: 'Sociales', description: 'Área de Sociales' },
];

export const initialCourses: CreateCourseDto[] = [
  { name: 'Biología', color: '#3F51B5', description: 'AZUL ARÁNDANO' },
  { name: 'Cívica', color: '#E67C73', description: 'ROSA CHICLE' },
  { name: 'Física', color: '#0B8043', description: 'VERDE MUSGO' },
  { name: 'Filosofía', color: '#8E24AA', description: 'MORADO INTENSO' },
  { name: 'Geografía', color: '#7986CB', description: 'LAVANDA' },
  { name: 'Historia', color: '#039BE5', description: 'AZUL TURQUESA' },
  { name: 'Inglés', color: '#F6BF26', description: 'AMARILLO HUEVO' },
  { name: 'Lenguaje', color: '#616161', description: 'GRAFITO' },
  { name: 'Literatura', color: '#E67C73 ', description: 'ROSA CHICLE' },
  { name: 'Psicología', color: '#8E24AA', description: 'MORADO INTENSO' },
  { name: 'Química', color: '#F6BF26', description: 'AMARILLO HUEVO' },
  { name: 'Matemática', color: '#33B679', description: 'VERDE ESMERALDA' },
  { name: 'Raz. Lógico', color: '#7986CB', description: 'LAVANDA' },
  { name: 'Raz. Matemático', color: '#D50000', description: 'TOMATE' },
  { name: 'Raz. Verbal', color: '#F4511E', description: 'MANDARINA' },
];
