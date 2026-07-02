import 'reflect-metadata';
import { Injectable } from '@nestjs/common';

@Injectable()
class A {}

@Injectable()
class B {
  constructor(private readonly a: A) {}
}

console.log('paramtypes:', Reflect.getMetadata('design:paramtypes', B));
