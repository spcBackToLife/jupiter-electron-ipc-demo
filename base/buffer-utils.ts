import { hasBuffer, VSBuffer } from "./buffer";

interface IReader {
  read(bytes: number): VSBuffer;
}

interface IWriter {
  write(buffer: VSBuffer): void;
}

export class BufferReader implements IReader {
  private pos = 0;

  constructor(private readonly buffer: VSBuffer) {}

  read(bytes: number): VSBuffer {
    const result = this.buffer.slice(this.pos, this.pos + bytes);
    this.pos += result.byteLength;
    return result;
  }
}

export class BufferWriter implements IWriter {
  private readonly buffers: VSBuffer[] = [];

  get buffer(): VSBuffer {
    return VSBuffer.concat(this.buffers);
  }

  write(buffer: VSBuffer): void {
    this.buffers.push(buffer);
  }
}

enum DataType {
  Undefined = 0,
  String = 1,
  Buffer = 2,
  VSBuffer = 3,
  Array = 4,
  Object = 5,
}

function readSizeBuffer(reader: IReader): number {
  return reader.read(4).readUInt32BE(0);
}

function createOneByteBuffer(value: number): VSBuffer {
  const result = VSBuffer.alloc(1);
  result.writeUInt8(value, 0);
  return result;
}

const BufferPresets = {
  Undefined: createOneByteBuffer(DataType.Undefined),
  String: createOneByteBuffer(DataType.String),
  Buffer: createOneByteBuffer(DataType.Buffer),
  VSBuffer: createOneByteBuffer(DataType.VSBuffer),
  Array: createOneByteBuffer(DataType.Array),
  Object: createOneByteBuffer(DataType.Object),
};


function createSizeBuffer(size: number): VSBuffer {
  const result = VSBuffer.alloc(4);
  result.writeUInt32BE(size, 0);
  return result;
}


export function serialize(writer: IWriter, data: any): void {
  if (typeof data === 'undefined') {
    writer.write(BufferPresets.Undefined);
  } else if (typeof data === 'string') {
    const buffer = VSBuffer.fromString(data);
    writer.write(BufferPresets.String);
    writer.write(createSizeBuffer(buffer.byteLength));
    writer.write(buffer);
  } else if (hasBuffer && Buffer.isBuffer(data)) {
    const buffer = VSBuffer.wrap(data);
    writer.write(BufferPresets.Buffer);
    writer.write(createSizeBuffer(buffer.byteLength));
    writer.write(buffer);
  } else if (data instanceof VSBuffer) {
    writer.write(BufferPresets.VSBuffer);
    writer.write(createSizeBuffer(data.byteLength));
    writer.write(data);
  } else if (Array.isArray(data)) {
    writer.write(BufferPresets.Array);
    writer.write(createSizeBuffer(data.length));

    for (const el of data) {
      serialize(writer, el);
    }
  } else {
    const buffer = VSBuffer.fromString(JSON.stringify(data));
    writer.write(BufferPresets.Object);
    writer.write(createSizeBuffer(buffer.byteLength));
    writer.write(buffer);
  }
}


export function deserialize(reader: IReader): any {
  const type = reader.read(1).readUInt8(0);

  switch (type) {
    case DataType.Undefined:
      return undefined;
    case DataType.String:
      return reader.read(readSizeBuffer(reader)).toString();
    case DataType.Buffer:
      return reader.read(readSizeBuffer(reader)).buffer;
    case DataType.VSBuffer:
      return reader.read(readSizeBuffer(reader));
    case DataType.Array: {
      const length = readSizeBuffer(reader);
      const result: any[] = [];

      for (let i = 0; i < length; i++) {
        result.push(deserialize(reader));
      }

      return result;
    }
    case DataType.Object:
      return JSON.parse(reader.read(readSizeBuffer(reader)).toString());
    default:
      break;
  }
}
